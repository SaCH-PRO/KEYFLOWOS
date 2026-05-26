"use client";

import { ModuleShell } from "@/components/ui/module-shell";
import { CalendarDays, Calendar, Phone } from "lucide-react";


const scheduleTabs = [
  { label: "Calendar", href: "/app/schedule/calendar", icon: CalendarDays },
  { label: "Bookings", href: "/app/schedule/bookings", icon: Calendar },
  { label: "Calls", href: "/app/schedule/calls", icon: Phone },
];

export default function ScheduleCalendarPage() {
  return (
    <ModuleShell
      icon={CalendarDays}
      title="Calendar"
      subtitle="Your schedule & Google Calendar sync"
      tabs={scheduleTabs}
    />
  );
}
