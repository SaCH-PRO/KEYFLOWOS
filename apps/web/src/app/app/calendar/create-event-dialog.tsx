"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@keyflow/ui";
import { toast } from "sonner";
import { SideSheet } from "@/components/ui/side-sheet";
import {
  createCalendarEvent,
  type CalendarEventType,
} from "@/lib/client";
import { ALL_TYPES } from "./calendar-utils";

interface Props {
  open: boolean;
  businessId: string;
  defaultDate?: Date | null;
  onClose: () => void;
  onCreated: () => void;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function defaultStart(date?: Date | null) {
  const d = date ? new Date(date) : new Date();
  d.setMinutes(0, 0, 0);
  if (!date) d.setHours(d.getHours() + 1);
  else d.setHours(9);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function CreateEventDialog({
  open,
  businessId,
  defaultDate,
  onClose,
  onCreated,
}: Props) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<CalendarEventType>("ACTIVITY_LOG");
  const [start, setStart] = useState(defaultStart(defaultDate));
  const [end, setEnd] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"PRIVATE" | "TEAM" | "PUBLIC">("PRIVATE");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    if (!start) {
      toast.error("Start is required");
      return;
    }
    setSaving(true);
    const res = await createCalendarEvent(businessId, {
      title: title.trim(),
      description: description || null,
      type,
      startAt: new Date(start).toISOString(),
      endAt: end ? new Date(end).toISOString() : null,
      allDay,
      visibility,
    });
    setSaving(false);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    toast.success("Event created");
    setTitle("");
    setDescription("");
    setEnd("");
    onCreated();
    onClose();
  };

  return (
    <SideSheet
      open={open}
      onClose={onClose}
      title="New event"
      subtitle="Create a manual block on the calendar."
      width="md"
      footer={
        <div className="flex items-center justify-end gap-2 w-full">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={saving}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
            Create
          </Button>
        </div>
      }
    >
      <div className="p-4 space-y-3 text-sm">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What is this event?"
            className="kf-input w-full"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as CalendarEventType)}
            className="kf-input w-full"
          >
            {ALL_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.toLowerCase().replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={allDay}
            onChange={(e) => setAllDay(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          All-day event
        </label>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Start</label>
            <input
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="kf-input w-full"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">End</label>
            <input
              type="datetime-local"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="kf-input w-full"
            />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Visibility</label>
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as typeof visibility)}
            className="kf-input w-full"
          >
            <option value="PRIVATE">Private</option>
            <option value="TEAM">Team</option>
            <option value="PUBLIC">Public (customer-facing)</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Notes</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className="kf-input w-full resize-none"
          />
        </div>
      </div>
    </SideSheet>
  );
}
