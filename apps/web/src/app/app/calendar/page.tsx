"use client";

import { useEffect, useState } from "react";
import { CalendarDays, Brain } from "lucide-react";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { MasterCalendar } from "./master-calendar";
import { TemporalIntelligencePanel } from "./components/temporal-intelligence-panel";
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
      <div className="flex flex-col xl:flex-row gap-6">
        <div className="flex-1 min-w-0">
          {businessId ? (
            <MasterCalendar businessId={businessId} />
          ) : (
            <div className="flex items-center justify-center h-64">
              <div className="animate-pulse text-muted-foreground text-sm">Loading calendar...</div>
            </div>
          )}
        </div>
        <aside className="w-full xl:w-80 shrink-0 space-y-4">
          <div className="xl:sticky xl:top-4">
            <div className="flex items-center gap-2 mb-3">
              <Brain className="w-4 h-4 text-[hsl(var(--kf-accent2))]" />
              <h3 className="text-sm font-semibold text-foreground">AI Assistant</h3>
            </div>
            <TemporalIntelligencePanel />
          </div>
        </aside>
      </div>
    </WorkspaceShell>
  );
}
