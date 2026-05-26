"use client";

import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { MasterCalendar } from "./master-calendar";
import { refreshWorkspace, getStoredBusinessId } from "@/lib/workspace";


export default function CalendarPage() {
  const [businessId, setBusinessId] = useState<string | null>(null);

  useEffect(() => {
    const initWorkspace = async () => {
      const fresh = await refreshWorkspace();
      if (fresh) { setBusinessId(fresh); return; }
      const stored = getStoredBusinessId();
      if (stored) setBusinessId(stored);
    };
    void initWorkspace();
  }, []);

  return (
    <WorkspaceShell
      icon={CalendarDays}
      title="Calendar"
      subtitle="Unified view of bookings, tasks, deadlines, content, and external events"
      enableSwipe
    >
      {businessId ? (
        <MasterCalendar businessId={businessId} />
      ) : (
        <div className="flex items-center justify-center h-64">
          <div className="animate-pulse text-muted-foreground text-sm">Loading calendar...</div>
        </div>
      )}


    </WorkspaceShell>
  );
}
