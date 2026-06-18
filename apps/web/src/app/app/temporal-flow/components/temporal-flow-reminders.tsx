"use client";

import { Loader2, Bell } from "lucide-react";
import { TemporalFlowEvent } from "@/lib/api/temporal-flow";
import { TemporalFlowEventCard } from "./temporal-flow-event-card";

interface RemindersProps {
  reminders: TemporalFlowEvent[];
  loading: boolean;
  onRefresh: () => void;
}

export function TemporalFlowReminders({ reminders, loading, onRefresh }: RemindersProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (reminders.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Bell className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No reminders due.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {reminders.map((reminder) => (
        <TemporalFlowEventCard key={reminder.id} event={reminder} onResolved={onRefresh} />
      ))}
    </div>
  );
}
