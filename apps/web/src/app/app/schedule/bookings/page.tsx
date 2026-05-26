"use client";

import { ModuleShell } from "@/components/ui/module-shell";
import { CalendarDays, Calendar, Phone } from "lucide-react";


const scheduleTabs = [
  { label: "Calendar", href: "/app/schedule/calendar", icon: CalendarDays },
  { label: "Bookings", href: "/app/schedule/bookings", icon: Calendar },
  { label: "Calls", href: "/app/schedule/calls", icon: Phone },
];

export default function ScheduleBookingsPage() {
  return (
    <ModuleShell
      icon={Calendar}
      title="Bookings"
      subtitle="Appointment types & booking links"
      tabs={scheduleTabs}
    />
  );
}
