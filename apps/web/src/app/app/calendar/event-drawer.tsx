"use client";

import { useState } from "react";
import { Loader2, ExternalLink, Trash2 } from "lucide-react";
import { Button } from "@keyflow/ui";
import { toast } from "sonner";
import Link from "next/link";
import { SideSheet } from "@/components/ui/side-sheet";
import {
  cancelCalendarEvent,
  patchCalendarEvent,
  type CalendarEvent,
} from "@/lib/client";
import { fmtMoney, fmtTime, moduleMeta, reschedulePolicy } from "./calendar-utils";

interface Props {
  open: boolean;
  businessId: string;
  event: CalendarEvent | null;
  onClose: () => void;
  onChanged: () => void;
}

export function CalendarEventDrawer({ open, businessId, event, onClose, onChanged }: Props) {
  const [busy, setBusy] = useState<string | null>(null);

  if (!event) {
    return (
      <SideSheet open={open} onClose={onClose} title="Event" width="md">
        <div className="p-4 text-sm text-muted-foreground">No event selected.</div>
      </SideSheet>
    );
  }

  const meta = moduleMeta(event.module);
  const policy = reschedulePolicy(event);
  const start = new Date(event.startAt);
  const end = event.endAt ? new Date(event.endAt) : null;

  const markComplete = async () => {
    setBusy("complete");
    const res = await patchCalendarEvent(businessId, event.id, { status: "COMPLETED" });
    setBusy(null);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    toast.success("Marked complete");
    onChanged();
    onClose();
  };

  const cancel = async () => {
    if (!confirm("Cancel this event?")) return;
    setBusy("cancel");
    const res = await cancelCalendarEvent(businessId, event.id);
    setBusy(null);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    toast.success("Event cancelled");
    onChanged();
    onClose();
  };

  return (
    <SideSheet
      open={open}
      onClose={onClose}
      title={event.title}
      subtitle={`${meta.label} · ${event.type.toLowerCase()}`}
      width="md"
      footer={
        <div className="flex items-center justify-between gap-2 w-full">
          <Button
            variant="ghost"
            size="sm"
            onClick={cancel}
            disabled={!!busy || event.status === "CANCELLED"}
            className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
          >
            {busy === "cancel" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
            ) : (
              <Trash2 className="h-3.5 w-3.5 mr-1" />
            )}
            Cancel event
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={!!busy}>
              Close
            </Button>
            {event.status !== "COMPLETED" && (
              <Button size="sm" onClick={markComplete} disabled={!!busy}>
                {busy === "complete" && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
                Mark done
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="p-4 space-y-4 text-sm">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full font-medium"
            style={{ background: `${meta.color}1f`, color: meta.color }}
          >
            {meta.label}
          </span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted/40 text-muted-foreground">
            {event.status.toLowerCase()}
          </span>
          {event.priority !== "NORMAL" && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted/40 uppercase">
              {event.priority}
            </span>
          )}
          {event.visibility !== "PRIVATE" && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted/40">
              {event.visibility.toLowerCase()}
            </span>
          )}
          {event.syncStatus === "SYNCED" && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400">
              Synced to Google
            </span>
          )}
        </div>

        <dl className="grid grid-cols-[120px_1fr] gap-y-1 text-xs">
          <dt className="text-muted-foreground">When</dt>
          <dd>
            {event.allDay
              ? `All day · ${start.toLocaleDateString()}`
              : `${start.toLocaleString()}${end ? ` – ${fmtTime(end)}` : ""}`}
          </dd>
          {event.timezone && (
            <>
              <dt className="text-muted-foreground">Timezone</dt>
              <dd>{event.timezone}</dd>
            </>
          )}
          {event.contactId && (
            <>
              <dt className="text-muted-foreground">Contact</dt>
              <dd className="font-mono text-[11px]">{event.contactId}</dd>
            </>
          )}
          {event.staffId && (
            <>
              <dt className="text-muted-foreground">Staff</dt>
              <dd className="font-mono text-[11px]">{event.staffId}</dd>
            </>
          )}
          {event.assigneeId && (
            <>
              <dt className="text-muted-foreground">Assignee</dt>
              <dd className="font-mono text-[11px]">{event.assigneeId}</dd>
            </>
          )}
          {event.amount !== null && event.amount !== undefined && (
            <>
              <dt className="text-muted-foreground">Amount</dt>
              <dd className="text-emerald-400 font-medium">
                {fmtMoney(event.amount, event.currency)}
              </dd>
            </>
          )}
          <dt className="text-muted-foreground">Source</dt>
          <dd className="font-mono text-[11px] truncate">
            {event.sourceType}/{event.sourceId.slice(0, 12)}…
          </dd>
        </dl>

        {event.description && (
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">
              Notes
            </div>
            <p className="text-xs whitespace-pre-wrap">{event.description}</p>
          </div>
        )}

        {policy.locked && (
          <div
            className="p-2.5 rounded-lg text-xs"
            style={{
              background: "hsl(0 0% 50% / 0.08)",
              border: "1px solid hsl(0 0% 50% / 0.2)",
            }}
          >
            {policy.reason}
          </div>
        )}

        {event.sourceUrl && (
          <Link
            href={event.sourceUrl}
            className="inline-flex items-center text-xs text-blue-400 hover:text-blue-300"
          >
            <ExternalLink className="h-3 w-3 mr-1" />
            Open source object
          </Link>
        )}
      </div>
    </SideSheet>
  );
}
