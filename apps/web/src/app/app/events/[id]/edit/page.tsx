"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { getEvent, updateEvent, type Event } from "@/lib/api/events";
import { useEventsWorkspace } from "../../hooks/use-events-workspace";
import { EventForm } from "../../components/event-form";

export default function EditEventPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const eventId = params.id;
  const { businessId, loading: workspaceLoading, error: workspaceError } = useEventsWorkspace();

  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!businessId || !eventId) return;
    const load = async () => {
      setLoading(true);
      const { data, error: apiError } = await getEvent(businessId, eventId);
      if (apiError || !data) {
        setError(apiError ?? "Event not found");
        toast.error(apiError ?? "Event not found");
      } else {
        setEvent(data);
      }
      setLoading(false);
    };
    void load();
  }, [businessId, eventId]);

  if (workspaceLoading || loading || (!businessId && !workspaceError)) {
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

  if (error || !event) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center px-6">
        <h2 className="font-display text-title font-semibold text-foreground">Event not found</h2>
        <p className="text-body text-muted-foreground mt-2">{error ?? "This event does not exist."}</p>
        <button
          onClick={() => router.push("/app/events")}
          className="mt-6 px-4 h-10 rounded-xl bg-primary text-white text-sm font-semibold hover:opacity-90 transition-opacity"
        >
          Back to events
        </button>
      </div>
    );
  }

  return (
    <EventForm
      businessId={businessId}
      mode="edit"
      initialData={event}
      onSubmit={async (body) => {
        const { data, error } = await updateEvent(businessId, event.id, body);
        if (error || !data) return { error: error ?? "Failed to update event" };
        return { id: data.id };
      }}
    />
  );
}
