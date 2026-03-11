"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  Search,
  CalendarDays,
  LayoutGrid,
  Clock,
  List,
} from "lucide-react";
import type { Booking } from "../components/bookings-types";
import { contactName } from "../components/bookings-types";
import MonthGrid from "./month-grid";
import WeekTimeline from "./week-timeline";
import DayTimeline from "./day-timeline";

type ViewMode = "month" | "week" | "day";

interface CalendarViewProps {
  bookings: Booking[];
  onSelectBooking: (booking: Booking) => void;
  onCreateBooking?: (prefill: { date: string; time?: string }) => void;
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

const VIEW_ICONS: Record<ViewMode, typeof CalendarDays> = {
  month: LayoutGrid,
  week: CalendarDays,
  day: List,
};

export default function CalendarView({
  bookings,
  onSelectBooking,
  onCreateBooking,
}: CalendarViewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window !== "undefined" && window.innerWidth < 640) return "day";
    return "week";
  });
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    function handleResize() {
      if (window.innerWidth < 640 && viewMode === "week") {
        setViewMode("day");
      }
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [viewMode]);

  const filteredBookings = useMemo(() => {
    if (!search.trim()) return bookings;
    const q = search.toLowerCase();
    return bookings.filter((b) => {
      const name = contactName(b).toLowerCase();
      const serviceName = b.service?.name?.toLowerCase() ?? "";
      const staffName = b.staff?.name?.toLowerCase() ?? "";
      return name.includes(q) || serviceName.includes(q) || staffName.includes(q);
    });
  }, [bookings, search]);

  const navigatePrev = useCallback(() => {
    setCurrentDate((d) => {
      const next = new Date(d);
      if (viewMode === "month") next.setMonth(next.getMonth() - 1);
      else if (viewMode === "week") next.setDate(next.getDate() - 7);
      else next.setDate(next.getDate() - 1);
      return next;
    });
  }, [viewMode]);

  const navigateNext = useCallback(() => {
    setCurrentDate((d) => {
      const next = new Date(d);
      if (viewMode === "month") next.setMonth(next.getMonth() + 1);
      else if (viewMode === "week") next.setDate(next.getDate() + 7);
      else next.setDate(next.getDate() + 1);
      return next;
    });
  }, [viewMode]);

  const goToday = useCallback(() => {
    setCurrentDate(new Date());
    setSelectedDay(null);
  }, []);

  const handleSelectDay = useCallback(
    (day: Date) => {
      setSelectedDay(day);
      setCurrentDate(day);
      setViewMode("day");
      const yyyy = day.getFullYear();
      const mm = String(day.getMonth() + 1).padStart(2, "0");
      const dd = String(day.getDate()).padStart(2, "0");
      onCreateBooking?.({ date: `${yyyy}-${mm}-${dd}` });
    },
    [onCreateBooking]
  );

  const handleSlotClick = useCallback(
    (date: string, time: string) => {
      onCreateBooking?.({ date, time });
    },
    [onCreateBooking]
  );

  const headerLabel = useMemo(() => {
    if (viewMode === "month") {
      return currentDate.toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      });
    }
    if (viewMode === "week") {
      const start = new Date(currentDate);
      start.setDate(start.getDate() - start.getDay());
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      const sameMonth = start.getMonth() === end.getMonth();
      if (sameMonth) {
        return `${start.toLocaleDateString("en-US", {
          month: "short",
        })} ${start.getDate()} – ${end.getDate()}, ${end.getFullYear()}`;
      }
      return `${start.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })} – ${end.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })}, ${end.getFullYear()}`;
    }
    return currentDate.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }, [viewMode, currentDate]);

  const isToday = isSameDay(currentDate, new Date());

  return (
    <div className="kf-card p-4 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <CalendarDays
            className="w-4 h-4 flex-shrink-0"
            style={{ color: "hsl(var(--kf-accent1))" }}
          />
          <h3 className="text-sm font-semibold truncate">{headerLabel}</h3>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="flex items-center rounded-xl border border-border/50 overflow-hidden">
            {(["month", "week", "day"] as ViewMode[]).map((mode) => {
              const Icon = VIEW_ICONS[mode];
              return (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`px-2.5 py-1.5 text-xs font-medium flex items-center gap-1 transition-colors ${
                    viewMode === mode
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                  }`}
                  style={
                    viewMode === mode
                      ? {
                          background:
                            "linear-gradient(to right, hsl(var(--kf-accent1)/0.15), hsl(var(--kf-accent2)/0.15))",
                        }
                      : undefined
                  }
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline capitalize">{mode}</span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={navigatePrev}
              className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors"
              aria-label="Previous"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={goToday}
              className={`px-3 py-1 text-xs rounded-lg transition-colors ${
                isToday
                  ? "text-muted-foreground"
                  : "kf-btn-secondary"
              }`}
              disabled={isToday}
            >
              Today
            </button>
            <button
              onClick={navigateNext}
              className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors"
              aria-label="Next"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search by client, service, or staff..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="kf-input w-full pl-10 text-sm"
        />
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={viewMode}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.15 }}
        >
          {viewMode === "month" && (
            <MonthGrid
              bookings={filteredBookings}
              currentDate={currentDate}
              onSelectDay={handleSelectDay}
              selectedDay={selectedDay}
            />
          )}
          {viewMode === "week" && (
            <WeekTimeline
              bookings={filteredBookings}
              currentDate={currentDate}
              onSelectBooking={onSelectBooking}
              onSlotClick={handleSlotClick}
            />
          )}
          {viewMode === "day" && (
            <DayTimeline
              bookings={filteredBookings}
              currentDate={currentDate}
              onSelectBooking={onSelectBooking}
              onSlotClick={handleSlotClick}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
