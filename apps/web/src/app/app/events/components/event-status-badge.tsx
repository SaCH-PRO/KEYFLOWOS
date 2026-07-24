"use client";

import { Badge } from "@/components/ui-v2";
import type { EventStatus } from "@/lib/api/events";

const statusColors: Record<EventStatus, "orange" | "teal" | "rose" | "muted"> = {
  DRAFT: "muted",
  PUBLISHED: "teal",
  CANCELLED: "rose",
  COMPLETED: "orange",
};

export function EventStatusBadge({ status }: { status: EventStatus }) {
  return <Badge color={statusColors[status]}>{status}</Badge>;
}
