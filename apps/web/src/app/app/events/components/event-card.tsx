"use client";

import { Calendar, MapPin, Ticket, Users, CheckCircle, DollarSign } from "lucide-react";
import { Surface } from "@/components/ui-v2";
import type { EventListItem } from "@/lib/api/events";
import { EventStatusBadge } from "./event-status-badge";

interface EventCardProps {
  event: EventListItem;
  onClick: () => void;
}

function formatEventDate(startsAt: string) {
  const date = new Date(startsAt);
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function EventCard({ event, onClick }: EventCardProps) {
  return (
    <Surface
      variant="interactive"
      className="p-5 cursor-pointer group"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="font-display text-title font-semibold text-foreground truncate group-hover:text-primary transition-colors">
            {event.name}
          </h3>
          <div className="flex items-center gap-1.5 text-body text-muted-foreground mt-1">
            <Calendar className="w-3.5 h-3.5 flex-shrink-0" />
            <span>{formatEventDate(event.startsAt)}</span>
          </div>
        </div>
        <EventStatusBadge status={event.status} />
      </div>

      {event.location && (
        <div className="flex items-center gap-1.5 text-body text-muted-foreground mb-4">
          <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="truncate">{event.location}</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 pt-4 border-t border-border">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Ticket className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Tickets</p>
            <p className="text-sm font-semibold">{event._count.ticketTypes}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-secondary/10 text-secondary">
            <Users className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Attendees</p>
            <p className="text-sm font-semibold">{event._count.attendees}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-mint/10 text-mint">
            <CheckCircle className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Checked in</p>
            <p className="text-sm font-semibold">{event._count.checkIns}</p>
          </div>
        </div>
        <div
          className="flex items-center gap-2"
          title="Revenue estimate is available on the event detail page"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gold/10 text-gold-foreground">
            <DollarSign className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Revenue</p>
            <p className="text-sm font-semibold">—</p>
          </div>
        </div>
      </div>
    </Surface>
  );
}
