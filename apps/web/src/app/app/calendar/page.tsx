"use client";

import { Suspense, useEffect, useState } from "react";
import { CalendarDays, Plus } from "lucide-react";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { refreshWorkspace, getStoredBusinessId } from "@/lib/workspace";
import { MasterCalendar } from "./master-calendar";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton, TableSkeleton } from "@/components/ui/skeleton";

function CalendarSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-40" />
        <div className="flex gap-2">
          <Skeleton className="h-9 w-9 kf-radius-md" />
          <Skeleton className="h-9 w-9 kf-radius-md" />
          <Skeleton className="h-9 w-24 kf-radius-md" />
        </div>
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-9 w-20 kf-radius-md" />
        <Skeleton className="h-9 w-20 kf-radius-md" />
        <Skeleton className="h-9 w-20 kf-radius-md" />
        <Skeleton className="h-9 w-20 kf-radius-md" />
      </div>
      <TableSkeleton rows={5} cols={7} />
    </div>
  );
}

function CalendarPageInner() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const fresh = await refreshWorkspace();
      const id = fresh ?? getStoredBusinessId();
      if (id) setBusinessId(id);
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return (
      <WorkspaceShell
        icon={CalendarDays}
        title="Calendar"
        subtitle="Master calendar across bookings, tasks, projects, marketing, invoices, and more."
      >
        <CalendarSkeleton />
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell
      icon={CalendarDays}
      title="Calendar"
      subtitle="Master calendar across bookings, tasks, projects, marketing, invoices, and more."
    >
      {businessId ? (
        <MasterCalendar businessId={businessId} />
      ) : (
        <EmptyState
          icon={CalendarDays}
          title="No workspace connected"
          description="Connect a business workspace to view your master calendar."
          actionLabel="Go to Settings"
          onAction={() => window.location.href = "/app/settings/business"}
          iconColor="hsl(var(--kf-accent1))"
        />
      )}
    </WorkspaceShell>
  );
}

export default function CalendarPage() {
  return (
    <Suspense fallback={<CalendarSkeleton />}>
      <CalendarPageInner />
    </Suspense>
  );
}
