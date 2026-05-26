"use client";

import { ModuleShell } from "@/components/ui/module-shell";
import { Bell } from "lucide-react";


export default function NotificationsPage() {
  return (
    <ModuleShell
      icon={Bell}
      title="Notifications"
      subtitle="All your alerts and updates"
    />
  );
}
