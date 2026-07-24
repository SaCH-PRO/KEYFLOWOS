"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Calendar, Plus, Search, Ticket } from "lucide-react";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { EmptyState } from "@/components/ui-v2";
import { listEvents, type EventListItem, type EventStatus } from "@/lib/api/events";
import { useEventsWorkspace } from "./hooks/use-events-workspace";
import { EventCard } from "./components/event-card";

const FILTER_TABS: { key: "ALL" | EventStatus; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "DRAFT", label: "Draft" },
  { key: "PUBLISHED", label: "Published" },
  { key: "CANCELLED", label: "Cancelled" },
  { key: "COMPLETED", label: "Completed" },
];

export default function EventsPage() {
  const router = useRouter();
  const { businessId, loading: workspaceLoading, error: workspaceError } = useEventsWorkspace();

  const [events, setEvents] = useState<EventListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | EventStatus>("ALL");

  useEffect(() => {
    if (!businessId) return;
    const load = async () => {
      setLoading(true);
      setError(null);
      const { data, error: apiError } = await listEvents(businessId, {
        status: statusFilter === "ALL" ? undefined : statusFilter,
        search: search.trim() || undefined,
      });
      if (apiError) {
        setError(apiError);
        toast.error(apiError);
      } else {
        setEvents(data?.items ?? []);
      }
      setLoading(false);
    };
    void load();
  }, [businessId, statusFilter, search]);

  if (workspaceLoading || (!businessId && !workspaceError)) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  if (workspaceError || !businessId) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center px-6">
        <h2 className="font-display text-title font-semibold text-foreground">Workspace not found</h2>
        <p className="text-body text-muted-foreground mt-2">{workspaceError ?? "Please sign in again."}</p>
      </div>
    );
  }

  return (
    <WorkspaceShell
      icon={Calendar}
      title="Events"
      subtitle="Create events, sell tickets, manage attendees and check-ins."
      actionLabel="New event"
      actionIcon={Plus}
      onAction={() => router.push("/app/events/new")}
      tabs={FILTER_TABS.map((t) => ({ ...t, icon: Ticket }))}
      activeTab={statusFilter}
      onTabChange={(key) => setStatusFilter(key as "ALL" | EventStatus)}
    >
      <div className="mb-5">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search events..."
            aria-label="Search events"
            className="w-full sm:w-80 h-11 pl-9 pr-3 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30"
          />
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-48 rounded-2xl bg-muted/50 animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-border bg-card p-8 text-center">
          <p className="text-body text-rose-600">{error}</p>
        </div>
      ) : events.length === 0 ? (
        <EmptyState
          icon={Calendar}
          title="No events yet"
          description="Create your first event to start selling tickets and tracking attendees."
          actionLabel="New event"
          onAction={() => router.push("/app/events/new")}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {events.map((event) => (
            <EventCard key={event.id} event={event} onClick={() => router.push(`/app/events/${event.id}`)} />
          ))}
        </div>
      )}
    </WorkspaceShell>
  );
}
