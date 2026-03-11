"use client";

import { useState, useMemo, useEffect } from "react";
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
  defaultDate?: string;
  defaultTime?: string;
}

export default function BookingForm({ services, staff, contacts, onSubmit, onCancel, formError, defaultDate, defaultTime }: BookingFormProps) {
  const [bookingDate, setBookingDate] = useState(defaultDate ?? "");
  const [bookingTime, setBookingTime] = useState(defaultTime ?? "");
  const [bookingServiceId, setBookingServiceId] = useState("");
  const [bookingStaffId, setBookingStaffId] = useState("");
  const [bookingContactId, setBookingContactId] = useState("");

  useEffect(() => {
    setBookingDate(defaultDate ?? "");
  }, [defaultDate]);

  useEffect(() => {
    setBookingTime(defaultTime ?? "");
  }, [defaultTime]);

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
      transition={{ duration: 0.2 }}
    >
      <div className="kf-card-accent p-3 sm:p-4 space-y-3 rounded-xl border border-border/50">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} /> New Booking
          </h3>
          <button onClick={onCancel} className="p-0.5 rounded-lg hover:bg-muted/50">
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>

        {formError && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-200">
            {formError}
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          <div>
            <label className="text-[10px] text-muted-foreground mb-1 block font-medium">Date</label>
            <input
              type="date"
              value={bookingDate}
              onChange={(e) => setBookingDate(e.target.value)}
              className="kf-input w-full text-xs h-8"
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground mb-1 block font-medium">Time</label>
            <input
              type="time"
              value={bookingTime}
              onChange={(e) => setBookingTime(e.target.value)}
              className="kf-input w-full text-xs h-8"
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground mb-1 block font-medium">Service</label>
            <select
              value={bookingServiceId}
              onChange={(e) => setBookingServiceId(e.target.value)}
              className="kf-input w-full text-xs h-8"
            >
              <option value="">Select...</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>{s.name} — {s.durationMins}m</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground mb-1 block font-medium">Staff</label>
            <select
              value={bookingStaffId}
              onChange={(e) => setBookingStaffId(e.target.value)}
              className="kf-input w-full text-xs h-8"
            >
              <option value="">Select...</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="col-span-2 sm:col-span-1 lg:col-span-2">
            <ContactSelect
              value={bookingContactId}
              onChange={(id) => setBookingContactId(id)}
              contacts={contacts}
              label="Contact (optional)"
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          {selectedService && computedEndTime ? (
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <Clock className="w-3 h-3" />
              <span>{selectedService.durationMins}m</span>
              <span className="opacity-40">·</span>
              <span>Ends {formatTime(computedEndTime)}</span>
              <span className="opacity-40">·</span>
              <DollarSign className="w-3 h-3" />
              <span>{selectedService.currency} {selectedService.price}</span>
            </div>
          ) : (
            <div />
          )}
          <div className="flex gap-1.5 flex-shrink-0">
            <button onClick={onCancel} className="kf-btn-secondary text-xs px-3 py-1.5">Cancel</button>
            <button onClick={handleSubmit} className="kf-btn-primary text-xs px-3 py-1.5">Book</button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
