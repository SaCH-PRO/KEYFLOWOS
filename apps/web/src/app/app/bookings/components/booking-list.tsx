"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  Calendar,
  Clock,
  CalendarDays,
  Plus,
  Search,
  RefreshCw,
  Filter,
  ChevronDown,
  X,
  MessageCircle,
  Lightbulb,
} from "lucide-react";
import { buildWhatsAppLink, getContactPhone } from "@/lib/whatsapp";
import type { Booking, StatusFilter } from "./bookings-types";
import { STATUS_STYLE, formatTime, formatDate, contactName } from "./bookings-types";

interface BookingListProps {
  filteredBookings: Booking[];
  loading: boolean;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  statusFilter: StatusFilter;
  setStatusFilter: (f: StatusFilter) => void;
  showFilters: boolean;
  setShowFilters: (v: boolean) => void;
  onSelectBooking: (booking: Booking) => void;
  selectedBooking: Booking | null;
  onCreateNew: () => void;
  onRefresh: () => void;
}

export default function BookingList({
  filteredBookings,
  loading,
  searchQuery,
  setSearchQuery,
  statusFilter,
  setStatusFilter,
  showFilters,
  setShowFilters,
  onSelectBooking,
  selectedBooking,
  onCreateNew,
  onRefresh,
}: BookingListProps) {
  return (
    <div className="kf-card p-4 space-y-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search bookings..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="kf-input w-full pl-10"
          />
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`kf-btn-secondary inline-flex items-center gap-2 ${showFilters ? "ring-2 ring-[hsl(var(--kf-accent1))]" : ""}`}
        >
          <Filter className="w-4 h-4" />
          Filters
          <ChevronDown className={`w-4 h-4 transition-transform ${showFilters ? "rotate-180" : ""}`} />
        </button>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="kf-btn-secondary inline-flex items-center gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="flex flex-wrap gap-2"
          >
            {(["ALL", "PENDING", "CONFIRMED", "COMPLETED", "CANCELLED"] as StatusFilter[]).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 text-sm rounded-lg transition-all ${
                  statusFilter === s ? "kf-btn-primary" : "kf-btn-secondary"
                }`}
              >
                {s === "ALL" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()}
              </button>
            ))}
            {statusFilter !== "ALL" && (
              <button
                onClick={() => {
                  setStatusFilter("ALL");
                  setSearchQuery("");
                }}
                className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
              >
                <X className="w-3 h-3" />
                Clear
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="space-y-3">
        {loading && filteredBookings.length === 0 ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="kf-card rounded-2xl p-4 flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl animate-pulse" style={{ background: "hsl(var(--kf-muted) / 0.3)" }} />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-2/5 rounded animate-pulse" style={{ background: "hsl(var(--kf-muted) / 0.3)" }} />
                  <div className="h-3 w-3/5 rounded animate-pulse" style={{ background: "hsl(var(--kf-muted) / 0.2)" }} />
                </div>
                <div className="h-6 w-16 rounded-full animate-pulse" style={{ background: "hsl(var(--kf-muted) / 0.2)" }} />
              </div>
            ))}
          </div>
        ) : filteredBookings.length === 0 ? (
          <div className="kf-card p-12 text-center">
            <div
              className="w-14 h-14 rounded-xl flex items-center justify-center mx-auto mb-4"
              style={{ background: "hsl(var(--kf-accent1) / 0.1)" }}
            >
              <Calendar className="w-7 h-7" style={{ color: "hsl(var(--kf-accent1) / 0.6)" }} />
            </div>
            <h3 className="text-lg font-semibold mb-1">
              {searchQuery || statusFilter !== "ALL" ? "No matching bookings" : "No bookings yet"}
            </h3>
            <p className="text-sm text-muted-foreground mb-4 max-w-sm mx-auto">
              {searchQuery || statusFilter !== "ALL"
                ? "Try adjusting your search or filters."
                : "Create your first booking to start managing your schedule."}
            </p>
            {!searchQuery && statusFilter === "ALL" && (
              <>
                <button
                  onClick={onCreateNew}
                  className="kf-btn-primary min-h-[44px] px-5 py-2.5 rounded-xl text-sm font-medium inline-flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  New Booking
                </button>
                <div
                  className="mt-6 mx-auto max-w-xs flex items-start gap-2 text-left px-4 py-3 kf-radius-md"
                  style={{
                    background: "hsl(var(--kf-warning) / 0.06)",
                    border: "1px solid hsl(var(--kf-warning) / 0.12)",
                  }}
                >
                  <Lightbulb
                    className="w-3.5 h-3.5 mt-0.5 flex-shrink-0"
                    style={{ color: "hsl(var(--kf-warning))" }}
                  />
                  <p className="kf-text-caption text-muted-foreground">
                    Set up your services in the Catalog tab first to enable online booking.
                  </p>
                </div>
              </>
            )}
          </div>
        ) : (
          filteredBookings.map((b, index) => (
            <motion.button
              key={b.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.03 }}
              onClick={() => onSelectBooking(b)}
              className={`w-full text-left kf-card rounded-2xl p-4 transition-all hover:ring-1 hover:ring-[hsl(var(--kf-accent1)/0.3)] ${
                selectedBooking?.id === b.id ? "ring-1 ring-[hsl(var(--kf-accent1)/0.4)]" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "hsl(var(--kf-accent1) / 0.1)", borderColor: "hsl(var(--kf-accent1) / 0.2)", borderWidth: 1 }}>
                    <Calendar className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{contactName(b)}</span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-medium border" style={STATUS_STYLE[b.status] ?? { background: "hsl(var(--muted) / 0.2)", color: "hsl(var(--muted-foreground))" }}>
                        {b.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                      <span className="flex items-center gap-1">
                        <CalendarDays className="w-3 h-3" /> {formatDate(b.startTime)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {formatTime(b.startTime)} – {formatTime(b.endTime)}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  {(() => {
                    const waPhone = b.contact ? getContactPhone(b.contact) : null;
                    if (!waPhone) return null;
                    const name = contactName(b);
                    const serviceName = b.service?.name ?? "upcoming";
                    return (
                      <a
                        href={buildWhatsAppLink(waPhone, `Hi ${name}, regarding your ${serviceName} appointment...`)}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Message on WhatsApp"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] -m-2 p-2 rounded-lg hover:bg-emerald-500/10 transition-colors"
                      >
                        <MessageCircle className="w-4 h-4 text-emerald-500" />
                      </a>
                    );
                  })()}
                  {b.service && (
                    <div className="text-right hidden sm:block">
                      <div className="text-xs font-medium">{b.service.name}</div>
                      <div className="text-[10px] text-muted-foreground">{b.service.duration} min</div>
                    </div>
                  )}
                  {b.staff && (
                    <div className="h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: "hsl(var(--kf-accent2) / 0.1)", borderColor: "hsl(var(--kf-accent2) / 0.2)", borderWidth: 1, color: "hsl(var(--kf-accent2))" }}>
                      {b.staff.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
              </div>
            </motion.button>
          ))
        )}
      </div>
    </div>
  );
}
