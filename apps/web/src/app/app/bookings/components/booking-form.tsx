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

  const selectedService = useMemo(() => services.find((s) => s.id === bookingServiceId), [services, bookingServiceId]);

  const computedEndTime = useMemo(() => {
    if (!bookingDate || !bookingTime || !selectedService) return "";
    const start = new Date(`${bookingDate}T${bookingTime}`);
    const end = new Date(start.getTime() + (selectedService.durationMins ?? 60) * 60 * 1000);
    return end.toISOString();
  }, [bookingDate, bookingTime, selectedService]);

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
            <ContactSelect
              value={bookingContactId}
              onChange={(id) => setBookingContactId(id)}
              contacts={contacts}
              label="Contact (optional)"
            />
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
