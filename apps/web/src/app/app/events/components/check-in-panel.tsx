"use client";

import { useMemo, useState } from "react";
import { Search, Users } from "lucide-react";
import { ProgressRing, EmptyState } from "@/components/ui-v2";
import type { AttendeeWithTicketType } from "@/lib/api/events";
import { CheckInAttendeeRow } from "./attendee-row";

interface CheckInPanelProps {
  attendees: AttendeeWithTicketType[];
  onCheckIn: (attendeeId: string) => Promise<void>;
  onUndo: (attendeeId: string) => Promise<void>;
  loadingIds?: Record<string, boolean>;
}

export function CheckInPanel({ attendees, onCheckIn, onUndo, loadingIds = {} }: CheckInPanelProps) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return attendees;
    return attendees.filter(
      (a) =>
        (a.name ?? "").toLowerCase().includes(q) ||
        a.email.toLowerCase().includes(q) ||
        (a.ticketType?.name ?? "").toLowerCase().includes(q),
    );
  }, [attendees, search]);

  const checkedInCount = attendees.filter((a) => a.status === "CHECKED_IN" || !!a.checkedInAt).length;
  const total = attendees.length;
  const progress = total > 0 ? Math.round((checkedInCount / total) * 100) : 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <ProgressRing value={progress} size={64} thickness={6} color="teal">
            <span className="font-display text-sm font-bold text-foreground">{progress}%</span>
          </ProgressRing>
          <div>
            <p className="font-display text-heading font-semibold text-foreground">
              {checkedInCount} of {total} checked in
            </p>
            <p className="text-body text-muted-foreground">
              {total - checkedInCount} remaining
            </p>
          </div>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search attendees..."
            aria-label="Search attendees"
            className="w-full sm:w-64 h-10 pl-9 pr-3 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No attendees found"
          description={search ? "Try a different search term." : "Add attendees to start checking them in."}
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((attendee) => (
            <CheckInAttendeeRow
              key={attendee.id}
              attendee={attendee}
              onCheckIn={() => onCheckIn(attendee.id)}
              onUndo={() => onUndo(attendee.id)}
              loading={loadingIds[attendee.id]}
            />
          ))}
        </div>
      )}
    </div>
  );
}
