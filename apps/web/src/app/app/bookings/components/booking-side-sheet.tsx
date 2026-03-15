"use client";

import { motion } from "framer-motion";
import { X, CalendarDays } from "lucide-react";
import type { Service, StaffMember, Contact } from "./bookings-types";
import BookingForm from "./booking-form";

interface BookingSideSheetProps {
  open: boolean;
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
  onClose: () => void;
  formError: string | null;
  defaultDate?: string;
  defaultTime?: string;
  saving?: boolean;
}

export default function BookingSideSheet({
  open,
  services,
  staff,
  contacts,
  onSubmit,
  onClose,
  formError,
  defaultDate,
  defaultTime,
  saving,
}: BookingSideSheetProps) {
  if (!open) return null;

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
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className="relative w-full max-w-lg h-full bg-background border-l border-border/60 overflow-y-auto"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border/40 sticky top-0 bg-background/95 backdrop-blur-sm z-10">
          <div className="flex items-center gap-2">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: "hsl(var(--kf-accent1)/0.12)" }}
            >
              <CalendarDays
                className="w-4 h-4"
                style={{ color: "hsl(var(--kf-accent1))" }}
              />
            </div>
            <h3 className="text-sm font-semibold">New Booking</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
        <div className="p-1">
          <BookingForm
            services={services}
            staff={staff}
            contacts={contacts}
            onSubmit={onSubmit}
            onCancel={onClose}
            formError={formError}
            defaultDate={defaultDate}
            defaultTime={defaultTime}
            saving={saving}
          />
        </div>
      </motion.div>
    </motion.div>
  );
}
