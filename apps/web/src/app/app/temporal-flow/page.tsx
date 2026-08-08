"use client";

import { Clock, CalendarDays, Bell, List, Sparkles, Brain, Calendar } from "lucide-react";
import { FlowShell } from "@/components/layout/flow-shell";
import { FlowQuickLauncher } from "@/components/layout/flow-quick-launcher";
import type { ModuleLauncherSection } from "@/components/ui/module-launcher-sheet";
import { TemporalFlowShell } from "./components/temporal-flow-shell";

function TemporalQuickLauncher() {
  const sections: ModuleLauncherSection[] = [
    {
      id: "time",
      label: "Time",
      items: [
        { id: "calendar", label: "Calendar", icon: CalendarDays, href: "/app/calendar", tone: "sky" },
        { id: "bookings", label: "Bookings", icon: Calendar, href: "/app/bookings", tone: "teal" },
        { id: "tasks", label: "Tasks", icon: List, href: "/app/approvals", tone: "orange" },
        { id: "reminders", label: "Reminders", icon: Bell, href: "/app/temporal-flow?tab=reminders", tone: "gold" },
      ],
    },
    {
      id: "intelligence",
      label: "Intelligence",
      items: [
        { id: "analysis", label: "KEY Analysis", icon: Sparkles, href: "/app/temporal-flow?tab=analysis", tone: "violet" },
        { id: "memory", label: "Memory", icon: Brain, href: "/app/temporal-flow?tab=memory", tone: "mint" },
      ],
    },
  ];

  return (
    <FlowQuickLauncher
      title="Temporal Modules"
      subtitle="Calendar, bookings, tasks, and memory"
      sections={sections}
    />
  );
}

export default function TemporalFlowPage() {
  return (
    <FlowShell
      title="Temporal Flow"
      subtitle="The living timeline of your business — events, reminders, and KEY intelligence."
      icon={Clock}
      activeFlowId="temporal"
      headerActions={<TemporalQuickLauncher />}
    >
      <TemporalFlowShell />
    </FlowShell>
  );
}
