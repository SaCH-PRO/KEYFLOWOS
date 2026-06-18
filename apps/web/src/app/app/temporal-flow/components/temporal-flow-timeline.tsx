"use client";

import { Loader2 } from "lucide-react";
import { TemporalFlowEvent } from "@/lib/api/temporal-flow";
import { TemporalFlowEventCard } from "./temporal-flow-event-card";

interface TimelineProps {
  events: TemporalFlowEvent[];
  loading: boolean;
  onRefresh: () => void;
}

export function TemporalFlowTimeline({ events, loading, onRefresh }: TimelineProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="text-sm">No events match your filters.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {events.map((event) => (
        <TemporalFlowEventCard key={event.id} event={event} onResolved={onRefresh} />
      ))}
    </div>
  );
}
