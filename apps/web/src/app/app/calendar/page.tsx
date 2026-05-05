"use client";

import { Suspense, useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { refreshWorkspace, getStoredBusinessId } from "@/lib/workspace";
import { MasterCalendar } from "./master-calendar";

function CalendarPageInner() {
  const [businessId, setBusinessId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const fresh = await refreshWorkspace();
      const id = fresh ?? getStoredBusinessId();
      if (id) setBusinessId(id);
    })();
  }, []);

  return (
    <WorkspaceShell
      icon={CalendarDays}
      title="Calendar"
      subtitle="Master calendar across bookings, tasks, projects, marketing, invoices, and more."
    >
      {businessId ? (
        <MasterCalendar businessId={businessId} />
      ) : (
        <div className="kf-card p-6 text-sm text-muted-foreground">
          Loading workspace…
        </div>
      )}
    </WorkspaceShell>
  );
}

export default function CalendarPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading…</div>}>
      <CalendarPageInner />
    </Suspense>
  );
}
