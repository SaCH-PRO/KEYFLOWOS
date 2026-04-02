"use client";

import { useState } from "react";
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
  RefreshCw,
  StickyNote,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Save,
} from "lucide-react";
import type { Booking } from "./bookings-types";
import { STATUS_STYLE, formatTime, formatFullDate, contactName } from "./bookings-types";

interface BookingDetailDrawerProps {
  selectedBooking: Booking;
  onClose: () => void;
  onStatusChange: (bookingId: string, newStatus: string) => void;
  onSyncCalendar: (bookingId: string) => void;
  onReschedule?: (bookingId: string, newStartTime: string) => void;
  onUpdateNotes?: (bookingId: string, notes: string) => void;
  calendarConnected: boolean;
}

function toDateStr(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function RescheduleForm({ onSubmit, onCancel, currentStartTime }: { onSubmit: (startTime: string) => void; onCancel: () => void; currentStartTime?: string }) {
  const [date, setDate] = useState(() => {
    if (!currentStartTime) return "";
    const d = new Date(currentStartTime);
    return toDateStr(d);
  });
  const [time, setTime] = useState(() => {
    if (!currentStartTime) return "";
    const d = new Date(currentStartTime);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  });

  const [weekBase, setWeekBase] = useState(() => currentStartTime ? new Date(currentStartTime) : new Date());

  const weekDays = (() => {
    const start = new Date(weekBase);
    start.setDate(start.getDate() - start.getDay());
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  })();

  const today = new Date();

  const timeSlots = (() => {
    const slots: { value: string; label: string }[] = [];
    for (let h = 7; h <= 20; h++) {
      for (const m of [0, 30]) {
        if (h === 20 && m === 30) continue;
        const value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
        const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
        const ampm = h >= 12 ? "PM" : "AM";
        slots.push({ value, label: `${hour12}:${String(m).padStart(2, "0")} ${ampm}` });
      }
    }
    return slots;
  })();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">New Date</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setWeekBase((prev) => { const d = new Date(prev); d.setDate(d.getDate() - 7); return d; })}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-muted/50"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setWeekBase((prev) => { const d = new Date(prev); d.setDate(d.getDate() + 7); return d; })}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-muted/50"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {weekDays.map((day) => {
          const ds = toDateStr(day);
          const sel = date === ds;
          const isPast = day < today && !(day.toDateString() === today.toDateString());
          return (
            <button
              key={ds}
              disabled={isPast}
              onClick={() => setDate(ds)}
              className={`flex flex-col items-center py-1.5 rounded-lg text-center transition-all min-h-[44px] justify-center ${
                sel ? "ring-1 ring-[hsl(var(--kf-accent1)/0.5)]" : isPast ? "opacity-30 cursor-not-allowed" : "hover:bg-muted/40"
              }`}
              style={sel ? { background: "hsl(var(--kf-accent1)/0.12)" } : undefined}
            >
              <span className="text-[9px] font-medium uppercase">{day.toLocaleDateString("en-US", { weekday: "short" })}</span>
              <span className="text-sm font-bold" style={sel ? { color: "hsl(var(--kf-accent1))" } : undefined}>{day.getDate()}</span>
            </button>
          );
        })}
      </div>

      <div>
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">New Time</span>
        <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-thin">
          {timeSlots.map((slot) => (
            <button
              key={slot.value}
              onClick={() => setTime(slot.value)}
              className={`flex-shrink-0 px-2 py-1.5 rounded-lg text-[11px] font-medium transition-all whitespace-nowrap border min-h-[44px] ${
                time === slot.value
                  ? "border-[hsl(var(--kf-accent1)/0.5)] ring-1 ring-[hsl(var(--kf-accent1)/0.3)]"
                  : "border-border/40 hover:border-border/70 hover:bg-muted/30 text-muted-foreground"
              }`}
              style={time === slot.value ? { background: "hsl(var(--kf-accent1)/0.12)" } : undefined}
            >
              {slot.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <button onClick={onCancel} className="flex-1 px-3 min-h-[44px] text-xs rounded-lg border border-border/50 hover:bg-muted/50 transition-colors text-muted-foreground">
          Cancel
        </button>
        <button
          onClick={() => { if (date && time) onSubmit(new Date(`${date}T${time}`).toISOString()); }}
          disabled={!date || !time}
          className="flex-1 px-3 min-h-[44px] text-xs font-semibold rounded-lg text-foreground transition-all disabled:opacity-40"
          style={{ background: date && time ? "hsl(var(--kf-accent1))" : "hsl(var(--kf-accent1)/0.4)" }}
        >
          Confirm Reschedule
        </button>
      </div>
    </div>
  );
}

export default function BookingDetailDrawer({
  selectedBooking,
  onClose,
  onStatusChange,
  onSyncCalendar,
  onReschedule,
  onUpdateNotes,
  calendarConnected,
}: BookingDetailDrawerProps) {
  const [showReschedule, setShowReschedule] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesText, setNotesText] = useState(selectedBooking.notes ?? "");

  const canReschedule = selectedBooking.status === "PENDING" || selectedBooking.status === "CONFIRMED";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-start justify-end"
    >
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", damping: 25 }}
        className="relative w-full max-w-md h-full bg-background border-l border-border/60 overflow-y-auto p-6 space-y-5"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold">Booking Details</h3>
          <button onClick={onClose} className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-muted/50">
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

          <div className="kf-card p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide flex items-center gap-1.5">
                <StickyNote className="w-3.5 h-3.5" />
                Notes
              </div>
              {!editingNotes && onUpdateNotes && (
                <button
                  onClick={() => { setNotesText(selectedBooking.notes ?? ""); setEditingNotes(true); }}
                  className="flex items-center gap-1 text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors min-h-[44px]"
                >
                  <Pencil className="w-2.5 h-2.5" />
                  {selectedBooking.notes ? "Edit" : "Add notes"}
                </button>
              )}
            </div>
            {editingNotes ? (
              <div className="space-y-2">
                <textarea
                  value={notesText}
                  onChange={(e) => setNotesText(e.target.value)}
                  rows={3}
                  className="kf-input w-full text-sm resize-none"
                  placeholder="Add notes about this booking..."
                  aria-label="Booking notes"
                />
                <div className="flex gap-1.5 justify-end">
                  <button
                    onClick={() => setEditingNotes(false)}
                    className="px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors min-h-[44px]"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      onUpdateNotes?.(selectedBooking.id, notesText);
                      setEditingNotes(false);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium rounded-md transition-colors min-h-[44px]"
                    style={{
                      background: "hsl(var(--kf-accent1) / 0.1)",
                      color: "hsl(var(--kf-accent1))",
                    }}
                  >
                    <Save className="w-2.5 h-2.5" />
                    Save
                  </button>
                </div>
              </div>
            ) : selectedBooking.notes ? (
              <p className="text-sm text-foreground/90 whitespace-pre-wrap">{selectedBooking.notes}</p>
            ) : (
              <p className="text-[11px] text-muted-foreground/50 italic">No notes yet</p>
            )}
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
              {(selectedBooking.service.bufferMins || selectedBooking.service.leadTimeMins) && (
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground pt-1 border-t border-border/30">
                  {selectedBooking.service.bufferMins ? (
                    <span>{selectedBooking.service.bufferMins}m buffer</span>
                  ) : null}
                  {selectedBooking.service.leadTimeMins ? (
                    <span>{selectedBooking.service.leadTimeMins}m lead time</span>
                  ) : null}
                </div>
              )}
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

        {showReschedule && canReschedule && onReschedule ? (
          <div className="kf-card p-4 space-y-3">
            <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide flex items-center gap-1.5">
              <RefreshCw className="w-3.5 h-3.5" />
              Reschedule Booking
            </div>
            <RescheduleForm
              currentStartTime={selectedBooking.startTime}
              onSubmit={(startTime) => {
                onReschedule(selectedBooking.id, startTime);
                setShowReschedule(false);
              }}
              onCancel={() => setShowReschedule(false)}
            />
          </div>
        ) : (
          <div className="space-y-2 pt-2 border-t border-border/40">
            <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-2">Actions</div>
            <div className="grid grid-cols-2 gap-2">
              {selectedBooking.status === "PENDING" && (
                <>
                  <button
                    onClick={() => onStatusChange(selectedBooking.id, "CONFIRMED")}
                    className="flex items-center justify-center gap-1.5 px-3 min-h-[44px] rounded-xl text-sm font-medium transition-colors"
                    style={{ background: "hsl(var(--kf-success) / 0.1)", borderWidth: 1, borderColor: "hsl(var(--kf-success) / 0.3)", color: "hsl(var(--kf-success))" }}
                  >
                    <CheckCircle2 className="w-4 h-4" /> Confirm
                  </button>
                  <button
                    onClick={() => onStatusChange(selectedBooking.id, "CANCELLED")}
                    className="flex items-center justify-center gap-1.5 px-3 min-h-[44px] rounded-xl text-sm font-medium transition-colors"
                    style={{ background: "hsl(var(--kf-error) / 0.1)", borderWidth: 1, borderColor: "hsl(var(--kf-error) / 0.3)", color: "hsl(var(--kf-error))" }}
                  >
                    <XCircle className="w-4 h-4" /> Cancel
                  </button>
                </>
              )}
              {selectedBooking.status === "CONFIRMED" && (
                <>
                  <button
                    onClick={() => onStatusChange(selectedBooking.id, "COMPLETED")}
                    className="flex items-center justify-center gap-1.5 px-3 min-h-[44px] rounded-xl text-sm font-medium border transition-colors"
                    style={{ background: "hsl(var(--kf-accent2) / 0.1)", borderColor: "hsl(var(--kf-accent2) / 0.3)", color: "hsl(var(--kf-accent2))" }}
                  >
                    <CheckCircle2 className="w-4 h-4" /> Complete
                  </button>
                  <button
                    onClick={() => onStatusChange(selectedBooking.id, "CANCELLED")}
                    className="flex items-center justify-center gap-1.5 px-3 min-h-[44px] rounded-xl text-sm font-medium transition-colors"
                    style={{ background: "hsl(var(--kf-error) / 0.1)", borderWidth: 1, borderColor: "hsl(var(--kf-error) / 0.3)", color: "hsl(var(--kf-error))" }}
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
            {canReschedule && onReschedule && (
              <button
                onClick={() => setShowReschedule(true)}
                className="w-full flex items-center justify-center gap-1.5 px-3 min-h-[44px] rounded-xl text-sm font-medium border transition-colors"
                style={{ background: "hsl(var(--kf-accent1) / 0.08)", borderColor: "hsl(var(--kf-accent1) / 0.2)", color: "hsl(var(--kf-accent1))" }}
              >
                <RefreshCw className="w-4 h-4" /> Reschedule
              </button>
            )}
            {calendarConnected && selectedBooking.status !== "CANCELLED" && (
              <button
                onClick={() => onSyncCalendar(selectedBooking.id)}
                className="w-full kf-btn-secondary flex items-center justify-center gap-1.5 px-3 min-h-[44px] text-sm"
              >
                <Link2 className="w-4 h-4" /> Sync to Google Calendar
              </button>
            )}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
