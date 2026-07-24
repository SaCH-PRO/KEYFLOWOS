"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Save, Calendar, MapPin, ImageIcon, Globe, FileText } from "lucide-react";
import { Button } from "@/components/ui-v2";
import type { CreateEventBody, Event } from "@/lib/api/events";

interface EventFormProps {
  businessId: string;
  mode: "create" | "edit";
  initialData?: Event;
  onSubmit: (body: CreateEventBody) => Promise<{ id?: string; error?: string | null }>;
}

const EVENT_STATUSES: Event["status"][] = ["DRAFT", "PUBLISHED", "CANCELLED", "COMPLETED"];

function toDatetimeLocalValue(isoString: string | null | undefined): string {
  if (!isoString) return "";
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function EventForm({ businessId: _businessId, mode, initialData, onSubmit }: EventFormProps) {
  const id = useId();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [name, setName] = useState(initialData?.name ?? "");
  const [description, setDescription] = useState(initialData?.description ?? "");
  const [startsAt, setStartsAt] = useState(toDatetimeLocalValue(initialData?.startsAt));
  const [endsAt, setEndsAt] = useState(toDatetimeLocalValue(initialData?.endsAt));
  const [timezone, setTimezone] = useState(initialData?.timezone ?? "UTC");
  const [location, setLocation] = useState(initialData?.location ?? "");
  const [coverImageUrl, setCoverImageUrl] = useState(initialData?.coverImageUrl ?? "");
  const [status, setStatus] = useState<Event["status"]>(initialData?.status ?? "DRAFT");
  const [isPublished, setIsPublished] = useState(initialData?.isPublished ?? false);

  const nameId = `${id}-name`;
  const descriptionId = `${id}-description`;
  const startsAtId = `${id}-starts-at`;
  const endsAtId = `${id}-ends-at`;
  const timezoneId = `${id}-timezone`;
  const locationId = `${id}-location`;
  const coverImageUrlId = `${id}-cover`;
  const statusId = `${id}-status`;
  const isPublishedId = `${id}-is-published`;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!name.trim()) {
      setFormError("Event name is required");
      return;
    }
    if (!startsAt.trim()) {
      setFormError("Start date is required");
      return;
    }

    const startsAtIso = new Date(startsAt).toISOString();
    const endsAtIso = endsAt ? new Date(endsAt).toISOString() : undefined;

    if (endsAtIso && new Date(endsAtIso) <= new Date(startsAtIso)) {
      setFormError("End date must be after the start date");
      return;
    }

    const body: CreateEventBody = {
      name: name.trim(),
      description: description.trim() || undefined,
      startsAt: startsAtIso,
      endsAt: endsAtIso ?? null,
      timezone: timezone.trim() || "UTC",
      location: location.trim() || undefined,
      coverImageUrl: coverImageUrl.trim() || undefined,
      status,
      isPublished,
    };

    setSaving(true);
    try {
      const result = await onSubmit(body);
      if (result.error) {
        setFormError(result.error);
        toast.error(result.error);
      } else {
        toast.success(mode === "create" ? "Event created" : "Event updated");
        if (result.id) {
          router.push(`/app/events/${result.id}`);
        } else {
          router.push("/app/events");
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save event";
      setFormError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-6xl mx-auto pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="p-2 rounded-xl hover:bg-muted transition-colors"
            aria-label="Go back"
          >
            <ArrowLeft className="w-4 h-4 text-muted-foreground" />
          </button>
          <div>
            <h1 className="font-display text-title font-semibold text-foreground">
              {mode === "create" ? "New Event" : "Edit Event"}
            </h1>
            <p className="text-body text-muted-foreground">
              {mode === "create" ? "Create a new event and start selling tickets." : "Update your event details."}
            </p>
          </div>
        </div>
        <Button type="submit" variant="primary" isLoading={saving} leftIcon={<Save className="w-4 h-4" />}>
          {mode === "create" ? "Create Event" : "Save Changes"}
        </Button>
      </div>

      {formError && (
        <div className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {formError}
        </div>
      )}

      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6 space-y-5 shadow-sm">
        <div className="space-y-1.5">
          <label htmlFor={nameId} className="text-caption font-semibold text-muted-foreground uppercase tracking-wide">
            Event name *
          </label>
          <input
            id={nameId}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Summer Music Festival"
            className="w-full h-11 px-3 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor={descriptionId} className="text-caption font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5" /> Description
          </label>
          <textarea
            id={descriptionId}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What's happening?"
            rows={4}
            className="w-full px-3 py-2.5 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 resize-none"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div className="space-y-1.5">
            <label htmlFor={startsAtId} className="text-caption font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" /> Starts at *
            </label>
            <input
              id={startsAtId}
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className="w-full h-11 px-3 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={endsAtId} className="text-caption font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" /> Ends at
            </label>
            <input
              id={endsAtId}
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              className="w-full h-11 px-3 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div className="space-y-1.5">
            <label htmlFor={timezoneId} className="text-caption font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5" /> Timezone
            </label>
            <input
              id={timezoneId}
              type="text"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="UTC"
              className="w-full h-11 px-3 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={locationId} className="text-caption font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5" /> Location
            </label>
            <input
              id={locationId}
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Venue or address"
              className="w-full h-11 px-3 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor={coverImageUrlId} className="text-caption font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <ImageIcon className="w-3.5 h-3.5" /> Cover image URL
          </label>
          <input
            id={coverImageUrlId}
            type="url"
            value={coverImageUrl}
            onChange={(e) => setCoverImageUrl(e.target.value)}
            placeholder="https://..."
            className="w-full h-11 px-3 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div className="space-y-1.5">
            <label htmlFor={statusId} className="text-caption font-semibold text-muted-foreground uppercase tracking-wide">
              Status
            </label>
            <select
              id={statusId}
              value={status}
              onChange={(e) => setStatus(e.target.value as Event["status"])}
              className="w-full h-11 px-3 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30"
            >
              {EVENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-3 h-11">
            <input
              type="checkbox"
              id={isPublishedId}
              checked={isPublished}
              onChange={(e) => setIsPublished(e.target.checked)}
              className="h-5 w-5 rounded-md border-border text-primary focus:ring-primary"
            />
            <label htmlFor={isPublishedId} className="text-body text-foreground font-medium cursor-pointer">
              Publish event page
            </label>
          </div>
        </div>
      </div>
    </form>
  );
}
