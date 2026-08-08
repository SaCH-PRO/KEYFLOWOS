"use client";

import { createEvent, type CreateEventBody } from "@/lib/api/events";
import { useEventsWorkspace } from "../hooks/use-events-workspace";
import { EventForm } from "../components/event-form";

export default function NewEventPage() {
  const { businessId, loading: workspaceLoading, error: workspaceError } = useEventsWorkspace();

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
    <EventForm
      businessId={businessId}
      mode="create"
      onSubmit={async (body) => {
        const { data, error } = await createEvent(businessId, body as CreateEventBody);
        if (error || !data) return { error: error ?? "Failed to create event" };
        return { id: data.id };
      }}
    />
  );
}
