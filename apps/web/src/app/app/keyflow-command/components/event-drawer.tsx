"use client";

import { useEffect, useState } from "react";
import { Loader2, Trash2, ExternalLink } from "lucide-react";
import { Button } from "@keyflow/ui";
import { toast } from "sonner";
import { SideSheet } from "@/components/ui/side-sheet";
import { apiPostSimple, apiPatch, apiDelete } from "@/lib/api";

export interface EventDrawerInitial {
  eventId?: string | null;
  summary?: string;
  description?: string;
  start?: string;
  end?: string;
  attendees?: string[];
  location?: string;
  htmlLink?: string;
  allDay?: boolean;
}

interface Props {
  open: boolean;
  businessId: string;
  initial: EventDrawerInitial | null;
  onClose: () => void;
  onSaved: () => void;
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toLocalInput(value?: string): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function fromLocalInput(value: string): string {
  if (!value) return "";
  return new Date(value).toISOString();
}

function toDateInput(value?: string): string {
  if (!value) return "";
  if (DATE_ONLY_RE.test(value)) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function addDaysToDateStr(dateStr: string, days: number): string {
  if (!DATE_ONLY_RE.test(dateStr)) return dateStr;
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

function defaultStart(): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return toLocalInput(d.toISOString());
}

function defaultEnd(startLocal: string): string {
  if (!startLocal) return "";
  const d = new Date(startLocal);
  d.setHours(d.getHours() + 1);
  return toLocalInput(d.toISOString());
}

function todayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function detectAllDay(initial: EventDrawerInitial | null | undefined): boolean {
  if (!initial) return false;
  if (typeof initial.allDay === "boolean") return initial.allDay;
  return !!initial.start && DATE_ONLY_RE.test(initial.start);
}

export function EventDrawer({ open, businessId, initial, onClose, onSaved }: Props) {
  const isEdit = !!initial?.eventId;
  const [title, setTitle] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [attendees, setAttendees] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [initialSnapshot, setInitialSnapshot] = useState<{
    title: string;
    allDay: boolean;
    start: string;
    end: string;
    attendees: string;
    notes: string;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    const allDayVal = detectAllDay(initial);
    let startVal: string;
    let endVal: string;
    if (allDayVal) {
      startVal = toDateInput(initial?.start) || todayDateStr();
      // Google's all-day end is exclusive; show inclusive (last day)
      const rawEnd = toDateInput(initial?.end) || addDaysToDateStr(startVal, 1);
      endVal = addDaysToDateStr(rawEnd, -1);
      if (endVal < startVal) endVal = startVal;
    } else {
      startVal = toLocalInput(initial?.start) || defaultStart();
      endVal = toLocalInput(initial?.end) || defaultEnd(startVal);
    }
    const titleVal = initial?.summary ?? "";
    const attendeesVal = (initial?.attendees ?? []).join(", ");
    const notesVal = initial?.description ?? "";
    setTitle(titleVal);
    setAllDay(allDayVal);
    setStart(startVal);
    setEnd(endVal);
    setAttendees(attendeesVal);
    setNotes(notesVal);
    setInitialSnapshot({
      title: titleVal,
      allDay: allDayVal,
      start: startVal,
      end: endVal,
      attendees: attendeesVal,
      notes: notesVal,
    });
  }, [open, initial]);

  const toggleAllDay = (next: boolean) => {
    if (next === allDay) return;
    if (next) {
      // Switch to all-day: keep date portion of current values
      const s = toDateInput(start) || todayDateStr();
      let e = toDateInput(end) || s;
      if (e < s) e = s;
      setAllDay(true);
      setStart(s);
      setEnd(e);
    } else {
      // Switch to timed: default to 9am-10am on the chosen date
      const sDate = DATE_ONLY_RE.test(start) ? start : todayDateStr();
      const eDate = DATE_ONLY_RE.test(end) && end >= sDate ? end : sDate;
      const s = `${sDate}T09:00`;
      const e = `${eDate}T10:00`;
      setAllDay(false);
      setStart(s);
      setEnd(e);
    }
  };

  const handleSave = async () => {
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    if (!start || !end) {
      toast.error("Start and end are required");
      return;
    }
    if (allDay) {
      if (!DATE_ONLY_RE.test(start) || !DATE_ONLY_RE.test(end)) {
        toast.error("Invalid date");
        return;
      }
      if (end < start) {
        toast.error("End must be on or after start");
        return;
      }
    } else if (new Date(end).getTime() <= new Date(start).getTime()) {
      toast.error("End must be after start");
      return;
    }
    setSaving(true);
    const attendeeList = attendees
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && /.+@.+\..+/.test(s));

    // For all-day: backend expects exclusive end (Google convention)
    const startPayload = allDay ? start : fromLocalInput(start);
    const endPayload = allDay ? addDaysToDateStr(end, 1) : fromLocalInput(end);

    let res;
    if (isEdit) {
      const snap = initialSnapshot;
      const patch: Record<string, unknown> = {};
      if (!snap || title !== snap.title) patch.summary = title.trim();
      if (!snap || notes !== snap.notes) patch.description = notes;
      const allDayChanged = !snap || allDay !== snap.allDay;
      if (allDayChanged) patch.allDay = allDay;
      if (allDayChanged || !snap || start !== snap.start) patch.start = startPayload;
      if (allDayChanged || !snap || end !== snap.end) patch.end = endPayload;
      if (!snap || attendees !== snap.attendees) patch.attendees = attendeeList;
      if (Object.keys(patch).length === 0) {
        setSaving(false);
        toast.success("No changes");
        onClose();
        return;
      }
      res = await apiPatch(
        `/bookings/businesses/${businessId}/calendar/events/${encodeURIComponent(initial!.eventId!)}`,
        patch,
      );
    } else {
      res = await apiPostSimple(
        `/bookings/businesses/${businessId}/calendar/events`,
        {
          summary: title.trim(),
          description: notes,
          start: startPayload,
          end: endPayload,
          allDay,
          attendees: attendeeList,
        },
      );
    }
    setSaving(false);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    toast.success(isEdit ? "Event updated" : "Event created");
    onSaved();
    onClose();
  };

  const handleDelete = async () => {
    if (!initial?.eventId) return;
    if (!confirm("Delete this Google Calendar event?")) return;
    setDeleting(true);
    const res = await apiDelete(
      `/bookings/businesses/${businessId}/calendar/events/${encodeURIComponent(initial.eventId)}`,
    );
    setDeleting(false);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    toast.success("Event deleted");
    onSaved();
    onClose();
  };

  return (
    <SideSheet
      open={open}
      onClose={onClose}
      title={isEdit ? "Edit Google event" : "New Google event"}
      subtitle={
        isEdit
          ? "Changes sync to Google Calendar."
          : "Creates an event on your connected Google Calendar."
      }
      width="md"
      footer={
        <div className="flex items-center justify-between gap-2 w-full">
          {isEdit ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDelete}
              disabled={deleting || saving}
              className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
            >
              {deleting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              ) : (
                <Trash2 className="h-3.5 w-3.5 mr-1" />
              )}
              Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={saving || deleting}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving || deleting}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              {isEdit ? "Save changes" : "Create event"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="p-4 space-y-4 text-sm">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Event title"
            className="w-full rounded-lg border border-border/50 bg-card/40 px-3 py-2 text-sm focus:outline-none focus:border-blue-500/50"
          />
        </div>

        <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground select-none">
          <input
            type="checkbox"
            checked={allDay}
            onChange={(e) => toggleAllDay(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-border/50"
          />
          All-day event
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Start</label>
            {allDay ? (
              <input
                type="date"
                value={start}
                onChange={(e) => {
                  const next = e.target.value;
                  setStart(next);
                  if (!end || end < next) setEnd(next);
                }}
                className="w-full rounded-lg border border-border/50 bg-card/40 px-3 py-2 text-sm focus:outline-none focus:border-blue-500/50"
              />
            ) : (
              <input
                type="datetime-local"
                value={start}
                onChange={(e) => {
                  const next = e.target.value;
                  setStart(next);
                  if (!end || new Date(end).getTime() <= new Date(next).getTime()) {
                    setEnd(defaultEnd(next));
                  }
                }}
                className="w-full rounded-lg border border-border/50 bg-card/40 px-3 py-2 text-sm focus:outline-none focus:border-blue-500/50"
              />
            )}
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              End{allDay ? " (inclusive)" : ""}
            </label>
            <input
              type={allDay ? "date" : "datetime-local"}
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="w-full rounded-lg border border-border/50 bg-card/40 px-3 py-2 text-sm focus:outline-none focus:border-blue-500/50"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Attendees <span className="text-[10px]">(comma-separated emails)</span>
          </label>
          <input
            type="text"
            value={attendees}
            onChange={(e) => setAttendees(e.target.value)}
            placeholder="alex@acme.com, sam@acme.com"
            className="w-full rounded-lg border border-border/50 bg-card/40 px-3 py-2 text-sm focus:outline-none focus:border-blue-500/50"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={5}
            placeholder="Agenda, links, context…"
            className="w-full rounded-lg border border-border/50 bg-card/40 px-3 py-2 text-sm resize-none focus:outline-none focus:border-blue-500/50"
          />
        </div>

        {isEdit && initial?.htmlLink && (
          <a
            href={initial.htmlLink}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center text-xs text-blue-400 hover:text-blue-300"
          >
            <ExternalLink className="h-3 w-3 mr-1" />
            Open in Google Calendar
          </a>
        )}
      </div>
    </SideSheet>
  );
}
