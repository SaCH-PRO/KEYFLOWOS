"use client";

import { motion, AnimatePresence } from "framer-motion";
import { InfoBadge } from "@/components/ui/info-badge";
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
} from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { CardListSkeleton } from "@/components/ui/skeleton";
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
          <InfoBadge title="Booking Filters" body="Filter by status (Confirmed, Pending, Cancelled, Completed), date range, or service type to find specific bookings." side="bottom" iconSize={11} />
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

      <div className="space-y-1">
        {loading && filteredBookings.length === 0 ? (
          <CardListSkeleton rows={4} />
        ) : filteredBookings.length === 0 ? (
          <EmptyState
            icon={Calendar}
            title={searchQuery || statusFilter !== "ALL" ? "No matching bookings" : "No bookings yet"}
            description={
              searchQuery || statusFilter !== "ALL"
                ? "Try adjusting your search or filters."
                : "Create your first booking to start managing your schedule."
            }
            tip={!searchQuery && statusFilter === "ALL" ? "Share your booking page link to let clients self-schedule. Set up services in the Catalog tab first." : undefined}
            actionLabel={!searchQuery && statusFilter === "ALL" ? "New Booking" : undefined}
            onAction={!searchQuery && statusFilter === "ALL" ? onCreateNew : undefined}
          />
        ) : (
          filteredBookings.map((b, index) => (
            <motion.button
              key={b.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index < 15 ? index * 0.02 : 0 }}
              onClick={() => onSelectBooking(b)}
              className={`w-full text-left rounded-xl border px-3 py-2 transition-all hover:bg-white/[0.03] hover:border-border/50 group ${
                selectedBooking?.id === b.id ? "border-[hsl(var(--kf-accent1))]/40 bg-[hsl(var(--kf-accent1))]/[0.04]" : "border-border/30 bg-white/[0.015]"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "hsl(var(--kf-accent1) / 0.1)", borderColor: "hsl(var(--kf-accent1) / 0.15)", borderWidth: 1 }}>
                  <Calendar className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-sm truncate">{contactName(b)}</span>
                    <span className="px-1.5 py-0.5 rounded-full text-[9px] font-medium border leading-none" style={STATUS_STYLE[b.status] ?? { background: "hsl(var(--muted) / 0.2)", color: "hsl(var(--muted-foreground))" }}>
                      {b.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground/60 mt-0.5">
                    <span className="flex items-center gap-0.5">
                      <CalendarDays className="w-3 h-3" /> {formatDate(b.startTime)}
                    </span>
                    <span className="flex items-center gap-0.5">
                      <Clock className="w-3 h-3" /> {formatTime(b.startTime)}–{formatTime(b.endTime)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
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
                        className="inline-flex items-center justify-center w-7 h-7 rounded-lg hover:bg-emerald-500/10 transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <MessageCircle className="w-3.5 h-3.5 text-emerald-500" />
                      </a>
                    );
                  })()}
                  {b.service && (
                    <div className="text-right hidden sm:block">
                      <div className="text-[11px] font-medium truncate max-w-[100px]">{b.service.name}</div>
                      <div className="text-[10px] text-muted-foreground/50">{b.service.duration}m</div>
                    </div>
                  )}
                  {b.staff && (
                    <div className="h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0" style={{ background: "hsl(var(--kf-accent2) / 0.1)", borderColor: "hsl(var(--kf-accent2) / 0.15)", borderWidth: 1, color: "hsl(var(--kf-accent2))" }}>
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
