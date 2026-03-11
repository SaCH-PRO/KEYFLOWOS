"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  Calendar,
  CalendarDays,
  Clock,
  Plus,
  X,
  CalendarCheck,
  Users,
  Loader2,
} from "lucide-react";
import type { SocialPost, Booking, Service, StaffMember } from "@/lib/client";

type CalendarEvent = {
  id: string;
  type: "post" | "booking";
  title: string;
  time: Date;
  endTime?: Date;
  status: string;
  raw: SocialPost | Booking;
};

type Props = {
  posts: SocialPost[];
  bookings: Booking[];
  services: Service[];
  staff: StaffMember[];
  onSelectPost: (post: SocialPost) => void;
  onSelectBooking?: (booking: Booking) => void;
  onCreateBooking?: (data: { date: string; time: string; serviceId: string; staffId: string }) => Promise<void> | void;
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAY_HOURS = Array.from({ length: 13 }, (_, i) => i + 7);

function getEventColor(type: "post" | "booking", status: string) {
  if (type === "booking") {
    switch (status) {
      case "CONFIRMED": return { bg: "bg-teal-500/20", border: "border-teal-500/40", text: "text-teal-400", dot: "bg-teal-400" };
      case "COMPLETED": return { bg: "bg-emerald-500/20", border: "border-emerald-500/40", text: "text-emerald-400", dot: "bg-emerald-400" };
      case "CANCELLED": return { bg: "bg-red-500/20", border: "border-red-500/40", text: "text-red-400", dot: "bg-red-400" };
      default: return { bg: "bg-amber-500/20", border: "border-amber-500/40", text: "text-amber-400", dot: "bg-amber-400" };
    }
  }
  switch (status) {
    case "POSTED": return { bg: "bg-emerald-500/20", border: "border-emerald-500/40", text: "text-emerald-400", dot: "bg-emerald-400" };
    case "SCHEDULED": return { bg: "bg-blue-500/20", border: "border-blue-500/40", text: "text-blue-400", dot: "bg-blue-400" };
    case "DRAFT": return { bg: "bg-slate-500/20", border: "border-slate-500/40", text: "text-slate-400", dot: "bg-slate-400" };
    default: return { bg: "bg-red-500/20", border: "border-red-500/40", text: "text-red-400", dot: "bg-red-400" };
  }
}

function formatHour(h: number) {
  if (h === 0 || h === 24) return "12am";
  if (h === 12) return "12pm";
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

function formatTimeShort(d: Date) {
  return d.toLocaleTimeString("en-TT", { hour: "numeric", minute: "2-digit", hour12: true });
}

function InlineBookingForm({
  date,
  time,
  services,
  staff,
  onSubmit,
  onClose,
}: {
  date: string;
  time: string;
  services: Service[];
  staff: StaffMember[];
  onSubmit: (data: { date: string; time: string; serviceId: string; staffId: string }) => Promise<void> | void;
  onClose: () => void;
}) {
  const [bookDate, setBookDate] = useState(date);
  const [bookTime, setBookTime] = useState(time);
  const [serviceId, setServiceId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setBookDate(date);
    setBookTime(time);
  }, [date, time]);

  const selectedService = useMemo(() => services.find((s) => s.id === serviceId), [services, serviceId]);
  const durationMins = selectedService ? (selectedService.durationMins ?? selectedService.duration ?? 60) : null;

  const endTimeLabel = useMemo(() => {
    if (!bookDate || !bookTime || !durationMins) return null;
    const start = new Date(`${bookDate}T${bookTime}`);
    if (isNaN(start.getTime())) return null;
    const end = new Date(start.getTime() + durationMins * 60 * 1000);
    return formatTimeShort(end);
  }, [bookDate, bookTime, durationMins]);

  const dateLabel = useMemo(() => {
    if (!bookDate) return "";
    const d = new Date(bookDate + "T12:00:00");
    return d.toLocaleDateString("en-TT", { weekday: "short", month: "short", day: "numeric" });
  }, [bookDate]);

  async function handleSubmit() {
    if (!bookDate || !bookTime) { setError("Date and time required"); return; }
    if (!serviceId) { setError("Select a service"); return; }
    if (!staffId) { setError("Select staff"); return; }
    setError("");
    setSubmitting(true);
    try {
      await onSubmit({ date: bookDate, time: bookTime, serviceId, staffId });
      onClose();
    } catch {
      setError("Failed to create booking");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <motion.div
      ref={formRef}
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="overflow-hidden"
    >
      <div
        className="rounded-xl border p-3 mb-3"
        style={{ background: "hsl(var(--kf-card))", borderColor: "hsl(var(--kf-accent1) / 0.3)" }}
      >
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2 text-xs font-semibold">
            <CalendarCheck className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
            New Booking
            {dateLabel && (
              <span className="text-muted-foreground font-normal">{dateLabel}</span>
            )}
          </div>
          <button onClick={onClose} className="p-0.5 rounded hover:bg-muted/50">
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-200 mb-2.5">
            {error}
          </div>
        )}

        <div className="flex flex-wrap items-end gap-2">
          <div className="w-[110px]">
            <label className="text-[10px] text-muted-foreground mb-1 block">Date</label>
            <input
              type="date"
              value={bookDate}
              onChange={(e) => setBookDate(e.target.value)}
              className="kf-input w-full text-xs !py-1.5"
            />
          </div>
          <div className="w-[90px]">
            <label className="text-[10px] text-muted-foreground mb-1 block">Time</label>
            <input
              type="time"
              value={bookTime}
              onChange={(e) => setBookTime(e.target.value)}
              className="kf-input w-full text-xs !py-1.5"
            />
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className="text-[10px] text-muted-foreground mb-1 block">Service</label>
            <select
              value={serviceId}
              onChange={(e) => setServiceId(e.target.value)}
              className="kf-input w-full text-xs !py-1.5"
            >
              <option value="">Select...</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.durationMins ?? s.duration ?? 60}m)
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[120px]">
            <label className="text-[10px] text-muted-foreground mb-1 block">Staff</label>
            <select
              value={staffId}
              onChange={(e) => setStaffId(e.target.value)}
              className="kf-input w-full text-xs !py-1.5"
            >
              <option value="">Select...</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            {endTimeLabel && durationMins && (
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                {durationMins}m &rarr; {endTimeLabel}
              </span>
            )}
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="kf-btn-primary text-xs !py-1.5 !px-3 flex items-center gap-1.5 whitespace-nowrap"
            >
              {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              Book
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function EventDetailPopover({
  event,
  position,
  onClose,
  onAction,
}: {
  event: CalendarEvent;
  position: { x: number; y: number };
  onClose: () => void;
  onAction: () => void;
}) {
  const sc = getEventColor(event.type, event.status);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="fixed z-50 w-64 rounded-xl border p-3 space-y-2 shadow-xl"
      style={{
        background: "hsl(var(--kf-card))",
        borderColor: "hsl(var(--kf-border))",
        top: Math.min(position.y, window.innerHeight - 200),
        left: Math.min(position.x, window.innerWidth - 280),
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${sc.dot}`} />
          <span className="text-xs font-semibold truncate">{event.title}</span>
        </div>
        <button onClick={onClose} className="p-0.5 rounded hover:bg-muted/50 flex-shrink-0">
          <X className="w-3 h-3" />
        </button>
      </div>
      <div className="space-y-1 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <Clock className="w-3 h-3" />
          <span>{formatTimeShort(event.time)}</span>
          {event.endTime && <span>– {formatTimeShort(event.endTime)}</span>}
        </div>
        <div className="flex items-center gap-1.5">
          {event.type === "booking" ? <Users className="w-3 h-3" /> : <Calendar className="w-3 h-3" />}
          <span className="capitalize">{event.type}</span>
          <span className={`px-1.5 py-0.5 rounded text-[10px] ${sc.bg} ${sc.text}`}>{event.status}</span>
        </div>
      </div>
      <button
        onClick={onAction}
        className="w-full kf-btn-primary text-[11px] !py-1.5"
      >
        {event.type === "booking" ? "View Booking" : "Edit Post"}
      </button>
    </motion.div>
  );
}

export function ContentCalendar({ posts, bookings, services, staff, onSelectPost, onSelectBooking, onCreateBooking }: Props) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<"month" | "week" | "day">(() => {
    if (typeof window !== "undefined" && window.innerWidth < 640) return "day";
    return "month";
  });
  const [showBookingForm, setShowBookingForm] = useState(false);
  const [bookingDefaults, setBookingDefaults] = useState({ date: "", time: "" });
  const [popoverEvent, setPopoverEvent] = useState<{ event: CalendarEvent; pos: { x: number; y: number } } | null>(null);
  const [filter, setFilter] = useState<"all" | "posts" | "bookings">("all");

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const events = useMemo<CalendarEvent[]>(() => {
    const items: CalendarEvent[] = [];
    if (filter !== "bookings") {
      posts.forEach((p) => {
        const d = p.postedAt || p.publishedAt || p.scheduledAt || p.scheduledFor || p.createdAt;
        items.push({
          id: `post-${p.id}`,
          type: "post",
          title: p.content.slice(0, 40),
          time: new Date(d),
          status: p.status,
          raw: p,
        });
      });
    }
    if (filter !== "posts") {
      bookings.forEach((b) => {
        const contactName = b.contact
          ? `${b.contact.firstName || ""} ${b.contact.lastName || ""}`.trim() || "Client"
          : "Client";
        const serviceName = b.service?.name || "Service";
        items.push({
          id: `booking-${b.id}`,
          type: "booking",
          title: `${contactName} — ${serviceName}`,
          time: new Date(b.startTime),
          endTime: new Date(b.endTime),
          status: b.status,
          raw: b,
        });
      });
    }
    return items;
  }, [posts, bookings, filter]);

  const eventsByDate = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    events.forEach((ev) => {
      const key = ev.time.toISOString().split("T")[0];
      if (!map[key]) map[key] = [];
      map[key].push(ev);
    });
    Object.values(map).forEach((arr) => arr.sort((a, b) => a.time.getTime() - b.time.getTime()));
    return map;
  }, [events]);

  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];

  const weekStart = useMemo(() => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() - d.getDay());
    d.setHours(0, 0, 0, 0);
    return d;
  }, [currentDate]);

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [weekStart]);

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  function prev() {
    if (view === "month") setCurrentDate(new Date(year, month - 1, 1));
    else if (view === "week") setCurrentDate(new Date(currentDate.getTime() - 7 * 86400000));
    else setCurrentDate(new Date(currentDate.getTime() - 86400000));
  }
  function next() {
    if (view === "month") setCurrentDate(new Date(year, month + 1, 1));
    else if (view === "week") setCurrentDate(new Date(currentDate.getTime() + 7 * 86400000));
    else setCurrentDate(new Date(currentDate.getTime() + 86400000));
  }

  const openBookingForm = useCallback((dateStr: string, hour?: number) => {
    const timeStr = hour !== undefined ? `${String(hour).padStart(2, "0")}:00` : "09:00";
    setBookingDefaults({ date: dateStr, time: timeStr });
    setShowBookingForm(true);
  }, []);

  const handleDayClick = useCallback((dateStr: string) => {
    setBookingDefaults({ date: dateStr, time: "09:00" });
    setShowBookingForm(true);
  }, []);

  const handleEventClick = useCallback((event: CalendarEvent, e: React.MouseEvent) => {
    e.stopPropagation();
    setPopoverEvent({ event, pos: { x: e.clientX, y: e.clientY } });
  }, []);

  const handlePopoverAction = useCallback(() => {
    if (!popoverEvent) return;
    const ev = popoverEvent.event;
    if (ev.type === "post") onSelectPost(ev.raw as SocialPost);
    else if (ev.type === "booking" && onSelectBooking) onSelectBooking(ev.raw as Booking);
    setPopoverEvent(null);
  }, [popoverEvent, onSelectPost, onSelectBooking]);

  async function handleBookingSubmit(data: { date: string; time: string; serviceId: string; staffId: string }) {
    await onCreateBooking?.(data);
  }

  const dayDateStr = currentDate.toISOString().split("T")[0];

  const titleText = view === "month"
    ? `${MONTHS[month]} ${year}`
    : view === "week"
    ? `Week of ${weekDays[0].toLocaleDateString("en-TT", { month: "short", day: "numeric" })} – ${weekDays[6].toLocaleDateString("en-TT", { month: "short", day: "numeric", year: "numeric" })}`
    : currentDate.toLocaleDateString("en-TT", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  const VIEWS: { key: "month" | "week" | "day"; label: string; icon: React.ElementType }[] = [
    { key: "month", label: "Month", icon: Calendar },
    { key: "week", label: "Week", icon: CalendarDays },
    { key: "day", label: "Day", icon: Clock },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{titleText}</h3>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-lg border overflow-hidden" style={{ borderColor: "hsl(var(--kf-border))" }}>
            {VIEWS.map((v) => {
              const Icon = v.icon;
              return (
                <button
                  key={v.key}
                  onClick={() => setView(v.key)}
                  className={`p-1.5 text-[10px] px-2 transition-colors flex items-center gap-1 ${view === v.key ? "text-[hsl(var(--kf-accent1))]" : "text-muted-foreground hover:text-foreground"}`}
                  style={view === v.key ? { background: "hsl(var(--kf-accent1) / 0.1)" } : {}}
                >
                  <Icon className="w-3 h-3" /> {v.label}
                </button>
              );
            })}
          </div>
          <div className="inline-flex rounded-lg border overflow-hidden" style={{ borderColor: "hsl(var(--kf-border))" }}>
            {(["all", "posts", "bookings"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`p-1.5 text-[10px] px-2 transition-colors capitalize ${filter === f ? "text-[hsl(var(--kf-accent1))]" : "text-muted-foreground hover:text-foreground"}`}
                style={filter === f ? { background: "hsl(var(--kf-accent1) / 0.1)" } : {}}
              >
                {f}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={prev} className="kf-btn-secondary w-7 h-7 flex items-center justify-center !p-0">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button onClick={() => setCurrentDate(new Date())} className="kf-btn-secondary text-[10px] !px-2 !py-1">
              Today
            </button>
            <button onClick={next} className="kf-btn-secondary w-7 h-7 flex items-center justify-center !p-0">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          {onCreateBooking && (
            <button
              onClick={() => {
                setBookingDefaults({ date: todayStr, time: "09:00" });
                setShowBookingForm(true);
              }}
              className="kf-btn-primary text-[10px] !px-2.5 !py-1.5 flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> Booking
            </button>
          )}
        </div>
      </div>

      <AnimatePresence>
        {showBookingForm && onCreateBooking && (
          <InlineBookingForm
            date={bookingDefaults.date}
            time={bookingDefaults.time}
            services={services}
            staff={staff}
            onSubmit={handleBookingSubmit}
            onClose={() => setShowBookingForm(false)}
          />
        )}
      </AnimatePresence>

      {view === "month" && (
        <div className="overflow-x-auto -mx-4 px-4 pb-1">
          <div className="grid grid-cols-7 gap-px rounded-xl overflow-hidden min-w-[500px]" style={{ border: "1px solid hsl(var(--kf-border))", background: "hsl(var(--kf-border))" }}>
            {DAYS.map((d) => (
              <div key={d} className="px-1 py-2 text-center text-[10px] uppercase tracking-wider text-muted-foreground font-medium" style={{ background: "hsl(var(--kf-muted))" }}>
                {d}
              </div>
            ))}
            {cells.map((day, i) => {
              if (day === null) {
                return <div key={`empty-${i}`} className="min-h-[80px]" style={{ background: "hsl(var(--kf-background))" }} />;
              }
              const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const dayEvents = eventsByDate[dateStr] || [];
              const isToday = dateStr === todayStr;
              const postCount = dayEvents.filter(e => e.type === "post").length;
              const bookingCount = dayEvents.filter(e => e.type === "booking").length;

              return (
                <div
                  key={dateStr}
                  className="min-h-[80px] p-1.5 relative cursor-pointer group transition-colors"
                  style={{
                    background: isToday ? "hsl(var(--kf-accent1) / 0.05)" : "hsl(var(--kf-card))",
                    ...(isToday ? { boxShadow: "inset 0 0 0 1px hsl(var(--kf-accent1) / 0.5)" } : {}),
                  }}
                  onClick={() => handleDayClick(dateStr)}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-[11px] font-medium ${isToday ? "text-[hsl(var(--kf-accent1))] font-bold" : "text-muted-foreground"}`}>
                      {day}
                    </span>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {onCreateBooking && (
                        <span
                          className="w-4 h-4 rounded flex items-center justify-center"
                          title="New booking"
                        >
                          <Plus className="w-3 h-3 text-muted-foreground" />
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="mt-1 space-y-0.5">
                    {dayEvents.slice(0, 3).map((ev) => {
                      const sc = getEventColor(ev.type, ev.status);
                      return (
                        <button
                          key={ev.id}
                          onClick={(e) => handleEventClick(ev, e)}
                          className={`w-full flex items-center gap-1 rounded-md px-1 py-0.5 text-[9px] ${sc.bg} border ${sc.border} ${sc.text} hover:brightness-125 transition-all truncate text-left`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${sc.dot}`} />
                          <span className="truncate">{ev.title.slice(0, 18)}</span>
                        </button>
                      );
                    })}
                    {dayEvents.length > 3 && (
                      <span className="text-[9px] text-muted-foreground pl-1">+{dayEvents.length - 3} more</span>
                    )}
                  </div>
                  {dayEvents.length === 0 && (
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                      <Plus className="w-4 h-4 text-muted-foreground/30" />
                    </div>
                  )}
                  {(postCount > 0 || bookingCount > 0) && (
                    <div className="absolute bottom-1 right-1 flex gap-0.5">
                      {postCount > 0 && <span className="w-1.5 h-1.5 rounded-full bg-blue-400/60" title={`${postCount} post(s)`} />}
                      {bookingCount > 0 && <span className="w-1.5 h-1.5 rounded-full bg-teal-400/60" title={`${bookingCount} booking(s)`} />}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {view === "week" && (
        <div className="overflow-x-auto -mx-4 px-4 pb-1">
          <div className="rounded-xl border overflow-hidden min-w-[600px]" style={{ borderColor: "hsl(var(--kf-border))" }}>
            <div className="grid grid-cols-[60px_repeat(7,1fr)] gap-px" style={{ background: "hsl(var(--kf-border))" }}>
              <div className="p-2" style={{ background: "hsl(var(--kf-muted))" }} />
              {weekDays.map((d) => {
                const ds = d.toISOString().split("T")[0];
                const isToday = ds === todayStr;
                const dayEvCount = (eventsByDate[ds] || []).length;
                return (
                  <div
                    key={ds}
                    className="p-2 text-center cursor-pointer hover:brightness-110 transition-all"
                    style={{
                      background: isToday ? "hsl(var(--kf-accent1) / 0.08)" : "hsl(var(--kf-muted))",
                    }}
                    onClick={() => handleDayClick(ds)}
                  >
                    <div className={`text-[10px] uppercase tracking-wider ${isToday ? "text-[hsl(var(--kf-accent1))] font-bold" : "text-muted-foreground"}`}>
                      {DAYS[d.getDay()]}
                    </div>
                    <div className={`text-sm font-bold ${isToday ? "text-[hsl(var(--kf-accent1))]" : ""}`}>
                      {d.getDate()}
                    </div>
                    {dayEvCount > 0 && (
                      <span className="text-[9px] text-muted-foreground/70">{dayEvCount} event{dayEvCount > 1 ? "s" : ""}</span>
                    )}
                  </div>
                );
              })}
            </div>
            {DAY_HOURS.map((hour) => (
              <div key={hour} className="grid grid-cols-[60px_repeat(7,1fr)] gap-px" style={{ background: "hsl(var(--kf-border))" }}>
                <div className="p-1.5 text-right text-[10px] text-muted-foreground" style={{ background: "hsl(var(--kf-background))" }}>
                  {formatHour(hour)}
                </div>
                {weekDays.map((d) => {
                  const ds = d.toISOString().split("T")[0];
                  const hourEvents = (eventsByDate[ds] || []).filter((ev) => ev.time.getHours() === hour);
                  return (
                    <div
                      key={`${ds}-${hour}`}
                      className="min-h-[36px] p-0.5 relative cursor-pointer hover:brightness-110 transition-all"
                      style={{ background: "hsl(var(--kf-card))" }}
                      onClick={() => openBookingForm(ds, hour)}
                    >
                      {hourEvents.map((ev) => {
                        const sc = getEventColor(ev.type, ev.status);
                        return (
                          <button
                            key={ev.id}
                            onClick={(e) => handleEventClick(ev, e)}
                            className={`w-full flex items-center gap-1 rounded px-1 py-0.5 text-[9px] mb-0.5 ${sc.bg} border ${sc.border} ${sc.text} hover:brightness-125 transition-all truncate text-left`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${sc.dot}`} />
                            <span className="truncate">{ev.title.slice(0, 14)}</span>
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {view === "day" && (
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: "hsl(var(--kf-border))" }}>
          {DAY_HOURS.map((hour) => {
            const hourEvents = (eventsByDate[dayDateStr] || []).filter((ev) => ev.time.getHours() === hour);
            const now = new Date();
            const isCurrentHour = dayDateStr === todayStr && now.getHours() === hour;

            return (
              <div
                key={hour}
                className="grid grid-cols-[60px_1fr] gap-px relative group cursor-pointer hover:brightness-110 transition-all"
                style={{ background: "hsl(var(--kf-border))" }}
                onClick={() => openBookingForm(dayDateStr, hour)}
              >
                <div className="p-2 text-right text-[10px] text-muted-foreground" style={{ background: "hsl(var(--kf-background))" }}>
                  {formatHour(hour)}
                </div>
                <div
                  className="min-h-[48px] p-1.5 relative"
                  style={{ background: isCurrentHour ? "hsl(var(--kf-accent1) / 0.03)" : "hsl(var(--kf-card))" }}
                >
                  {isCurrentHour && (
                    <div className="absolute left-0 right-0 h-[2px] bg-red-500/80 z-10 pointer-events-none" style={{ top: `${(now.getMinutes() / 60) * 100}%` }}>
                      <div className="w-2 h-2 rounded-full bg-red-500 absolute -left-1 -top-[3px]" />
                    </div>
                  )}
                  {hourEvents.length === 0 && (
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                      <span className="text-[10px] text-muted-foreground/40 flex items-center gap-1">
                        <Plus className="w-3 h-3" /> Add booking
                      </span>
                    </div>
                  )}
                  <div className="space-y-1">
                    {hourEvents.map((ev) => {
                      const sc = getEventColor(ev.type, ev.status);
                      return (
                        <button
                          key={ev.id}
                          onClick={(e) => handleEventClick(ev, e)}
                          className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs ${sc.bg} border ${sc.border} ${sc.text} hover:brightness-125 transition-all text-left`}
                        >
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${sc.dot}`} />
                          <span className="truncate flex-1">{ev.title}</span>
                          <span className="text-[10px] opacity-70 flex-shrink-0">
                            {formatTimeShort(ev.time)}
                            {ev.endTime && ` – ${formatTimeShort(ev.endTime)}`}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-teal-400" /> Confirmed</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" /> Pending</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400" /> Scheduled</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400" /> Posted/Done</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-400" /> Draft</span>
      </div>

      <AnimatePresence>
        {popoverEvent && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setPopoverEvent(null)} />
            <EventDetailPopover
              event={popoverEvent.event}
              position={popoverEvent.pos}
              onClose={() => setPopoverEvent(null)}
              onAction={handlePopoverAction}
            />
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
