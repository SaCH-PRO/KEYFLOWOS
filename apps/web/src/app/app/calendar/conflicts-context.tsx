"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { CalendarTypedConflict } from "@/lib/client";

interface ConflictsContextValue {
  conflicts: CalendarTypedConflict[];
  byEventId: Map<string, CalendarTypedConflict[]>;
}

const ConflictsContext = createContext<ConflictsContextValue>({
  conflicts: [],
  byEventId: new Map(),
});

export function ConflictsProvider({
  conflicts,
  children,
}: {
  conflicts: CalendarTypedConflict[];
  children: ReactNode;
}) {
  const value = useMemo<ConflictsContextValue>(() => {
    const byEventId = new Map<string, CalendarTypedConflict[]>();
    for (const c of conflicts) {
      for (const id of c.eventIds) {
        const arr = byEventId.get(id) ?? [];
        arr.push(c);
        byEventId.set(id, arr);
      }
    }
    return { conflicts, byEventId };
  }, [conflicts]);
  return (
    <ConflictsContext.Provider value={value}>
      {children}
    </ConflictsContext.Provider>
  );
}

export function useEventConflicts(eventId: string): CalendarTypedConflict[] {
  return useContext(ConflictsContext).byEventId.get(eventId) ?? [];
}

export function useAllConflicts(): CalendarTypedConflict[] {
  return useContext(ConflictsContext).conflicts;
}

export function useConflictedEventIds(): Set<string> {
  const { byEventId } = useContext(ConflictsContext);
  return useMemo(() => new Set(byEventId.keys()), [byEventId]);
}
