"use client";

import { motion } from "framer-motion";
import {
  CalendarDays,
  Clock,
  Briefcase,
  Mail,
  Phone,
  X,
  CheckCircle2,
  XCircle,
  Link2,
} from "lucide-react";
import type { Booking } from "./bookings-types";
import { STATUS_STYLE, formatTime, formatFullDate, contactName } from "./bookings-types";

interface BookingDetailDrawerProps {
  selectedBooking: Booking;
  onClose: () => void;
  onStatusChange: (bookingId: string, newStatus: string) => void;
  onSyncCalendar: (bookingId: string) => void;
  calendarConnected: boolean;
}

export default function BookingDetailDrawer({
  selectedBooking,
  onClose,
  onStatusChange,
  onSyncCalendar,
  calendarConnected,
}: BookingDetailDrawerProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-start justify-end"
    >
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <motion.div
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", damping: 25 }}
        className="relative w-full max-w-md h-full bg-background border-l border-border/60 overflow-y-auto p-6 space-y-5"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold">Booking Details</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted/50">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium border" style={STATUS_STYLE[selectedBooking.status] ?? { background: "hsl(var(--muted) / 0.2)", color: "hsl(var(--muted-foreground))" }}>
          {selectedBooking.status}
        </div>

        <div className="space-y-4">
          <div className="kf-card p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <CalendarDays className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
              <span className="font-medium">{formatFullDate(selectedBooking.startTime)}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Clock className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
              <span>{formatTime(selectedBooking.startTime)} – {formatTime(selectedBooking.endTime)}</span>
            </div>
          </div>

          {selectedBooking.contact && (
            <div className="kf-card p-4 space-y-2">
              <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Client</div>
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-full flex items-center justify-center text-sm font-bold" style={{ background: "hsl(var(--kf-accent1) / 0.1)", borderColor: "hsl(var(--kf-accent1) / 0.2)", borderWidth: 1, color: "hsl(var(--kf-accent1))" }}>
                  {(selectedBooking.contact.firstName?.charAt(0) ?? "?").toUpperCase()}
                </div>
                <div>
                  <div className="text-sm font-medium">{contactName(selectedBooking)}</div>
                  {selectedBooking.contact.email && (
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      <Mail className="w-3 h-3" /> {selectedBooking.contact.email}
                    </div>
                  )}
                  {selectedBooking.contact.phone && (
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      <Phone className="w-3 h-3" /> {selectedBooking.contact.phone}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {selectedBooking.service && (
            <div className="kf-card p-4 space-y-2">
              <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Service</div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Briefcase className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />
                  <span className="text-sm font-medium">{selectedBooking.service.name}</span>
                </div>
                <span className="text-sm text-muted-foreground">{selectedBooking.service.duration} min</span>
              </div>
              <div className="text-sm font-semibold" style={{ color: "hsl(var(--kf-accent1))" }}>
                TTD {selectedBooking.service.price.toLocaleString()}
              </div>
            </div>
          )}

          {selectedBooking.staff && (
            <div className="kf-card p-4 space-y-2">
              <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Staff</div>
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: "hsl(var(--kf-accent2) / 0.1)", borderColor: "hsl(var(--kf-accent2) / 0.2)", borderWidth: 1, color: "hsl(var(--kf-accent2))" }}>
                  {selectedBooking.staff.name.charAt(0).toUpperCase()}
                </div>
                <span className="text-sm font-medium">{selectedBooking.staff.name}</span>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-2 pt-2 border-t border-border/40">
          <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-2">Actions</div>
          <div className="grid grid-cols-2 gap-2">
            {selectedBooking.status === "PENDING" && (
              <>
                <button
                  onClick={() => onStatusChange(selectedBooking.id, "CONFIRMED")}
                  className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20 transition-colors"
                >
                  <CheckCircle2 className="w-4 h-4" /> Confirm
                </button>
                <button
                  onClick={() => onStatusChange(selectedBooking.id, "CANCELLED")}
                  className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium bg-red-500/10 border border-red-500/30 text-red-300 hover:bg-red-500/20 transition-colors"
                >
                  <XCircle className="w-4 h-4" /> Cancel
                </button>
              </>
            )}
            {selectedBooking.status === "CONFIRMED" && (
              <>
                <button
                  onClick={() => onStatusChange(selectedBooking.id, "COMPLETED")}
                  className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium border transition-colors" style={{ background: "hsl(var(--kf-accent2) / 0.1)", borderColor: "hsl(var(--kf-accent2) / 0.3)", color: "hsl(var(--kf-accent2))" }}
                >
                  <CheckCircle2 className="w-4 h-4" /> Complete
                </button>
                <button
                  onClick={() => onStatusChange(selectedBooking.id, "CANCELLED")}
                  className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium bg-red-500/10 border border-red-500/30 text-red-300 hover:bg-red-500/20 transition-colors"
                >
                  <XCircle className="w-4 h-4" /> Cancel
                </button>
              </>
            )}
            {(selectedBooking.status === "CANCELLED" || selectedBooking.status === "COMPLETED") && (
              <div className="col-span-2 text-center text-xs text-muted-foreground py-2">
                This booking is {selectedBooking.status.toLowerCase()}
              </div>
            )}
          </div>
          {calendarConnected && selectedBooking.status !== "CANCELLED" && (
            <button
              onClick={() => onSyncCalendar(selectedBooking.id)}
              className="w-full kf-btn-secondary flex items-center justify-center gap-1.5 px-3 py-2.5 text-sm"
            >
              <Link2 className="w-4 h-4" /> Sync to Google Calendar
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
