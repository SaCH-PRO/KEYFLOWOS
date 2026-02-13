"use client";

import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Plus,
  X,
  Clock,
  DollarSign,
} from "lucide-react";
import type { Service, StaffMember, Contact } from "./bookings-types";
import { formatTime } from "./bookings-types";

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
  }) => void;
  onCancel: () => void;
  formError: string | null;
}

export default function BookingForm({ services, staff, contacts, onSubmit, onCancel, formError }: BookingFormProps) {
  const [bookingDate, setBookingDate] = useState("");
  const [bookingTime, setBookingTime] = useState("");
  const [bookingServiceId, setBookingServiceId] = useState("");
  const [bookingStaffId, setBookingStaffId] = useState("");
  const [bookingContactId, setBookingContactId] = useState("");
  const [contactSearch, setContactSearch] = useState("");

  const selectedService = useMemo(() => services.find((s) => s.id === bookingServiceId), [services, bookingServiceId]);

  const computedEndTime = useMemo(() => {
    if (!bookingDate || !bookingTime || !selectedService) return "";
    const start = new Date(`${bookingDate}T${bookingTime}`);
    const end = new Date(start.getTime() + (selectedService.durationMins ?? 60) * 60 * 1000);
    return end.toISOString();
  }, [bookingDate, bookingTime, selectedService]);

  const filteredContacts = useMemo(() => {
    if (!contactSearch.trim()) return contacts.slice(0, 10);
    const q = contactSearch.toLowerCase();
    return contacts.filter((c) => {
      const name = `${c.firstName ?? ""} ${c.lastName ?? ""}`.toLowerCase();
      return name.includes(q) || (c.email?.toLowerCase().includes(q) ?? false);
    }).slice(0, 10);
  }, [contacts, contactSearch]);

  function handleSubmit() {
    onSubmit({
      date: bookingDate,
      time: bookingTime,
      serviceId: bookingServiceId,
      staffId: bookingStaffId,
      contactId: bookingContactId,
    });
  }

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
    >
      <div className="kf-card-accent p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Plus className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} /> Create New Booking
          </h3>
          <button onClick={onCancel} className="p-1 rounded-lg hover:bg-muted/50">
            <X className="w-4 h-4" />
          </button>
        </div>

        {formError && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            {formError}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block font-medium">Date</label>
            <input
              type="date"
              value={bookingDate}
              onChange={(e) => setBookingDate(e.target.value)}
              className="kf-input w-full"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block font-medium">Time</label>
            <input
              type="time"
              value={bookingTime}
              onChange={(e) => setBookingTime(e.target.value)}
              className="kf-input w-full"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block font-medium">Service</label>
            <select
              value={bookingServiceId}
              onChange={(e) => setBookingServiceId(e.target.value)}
              className="kf-input w-full"
            >
              <option value="">Select service...</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>{s.name} — {s.durationMins}min • {s.currency} {s.price}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block font-medium">Staff</label>
            <select
              value={bookingStaffId}
              onChange={(e) => setBookingStaffId(e.target.value)}
              className="kf-input w-full"
            >
              <option value="">Select staff...</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-muted-foreground mb-1.5 block font-medium">Contact (optional)</label>
            <div className="relative">
              <input
                type="text"
                placeholder="Search contacts..."
                value={contactSearch}
                onChange={(e) => {
                  setContactSearch(e.target.value);
                  if (!e.target.value.trim()) setBookingContactId("");
                }}
                className="kf-input w-full"
              />
              {contactSearch.trim() && (
                <div className="absolute top-full left-0 right-0 mt-1 kf-card rounded-xl border border-border/60 max-h-48 overflow-y-auto z-10">
                  {filteredContacts.length > 0 ? (
                    filteredContacts.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => {
                          setBookingContactId(c.id);
                          setContactSearch(`${c.firstName ?? ""} ${c.lastName ?? ""}`.trim());
                        }}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors ${bookingContactId === c.id ? "bg-[hsl(var(--kf-accent1)/0.1)]" : ""}`}
                      >
                        <div className="font-medium">{c.firstName} {c.lastName}</div>
                        {c.email && <div className="text-xs text-muted-foreground">{c.email}</div>}
                      </button>
                    ))
                  ) : (
                    <div className="px-3 py-2 text-sm text-muted-foreground">No contacts found</div>
                  )}
                </div>
              )}
              {bookingContactId && !contactSearch.trim() && (
                <div className="mt-1 text-xs text-emerald-400">Contact selected</div>
              )}
            </div>
          </div>
        </div>
        {selectedService && computedEndTime && (
          <div className="flex items-center gap-3 text-xs text-muted-foreground kf-card rounded-xl p-3">
            <Clock className="w-3.5 h-3.5" />
            <span>Duration: {selectedService.durationMins} min</span>
            <span>|</span>
            <span>Ends at: {formatTime(computedEndTime)}</span>
            <span>|</span>
            <DollarSign className="w-3.5 h-3.5" />
            <span>{selectedService.currency} {selectedService.price}</span>
          </div>
        )}
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="kf-btn-secondary">Cancel</button>
          <button onClick={handleSubmit} className="kf-btn-primary">Create Booking</button>
        </div>
      </div>
    </motion.div>
  );
}
