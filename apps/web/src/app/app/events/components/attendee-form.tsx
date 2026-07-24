"use client";

import { useId, useState } from "react";
import { User, Save, X } from "lucide-react";
import { Button } from "@/components/ui-v2";
import type { AttendeeStatus, AttendeeWithTicketType, CreateAttendeeBody, EventTicketType } from "@/lib/api/events";

interface AttendeeFormProps {
  ticketTypes: EventTicketType[];
  initialData?: AttendeeWithTicketType;
  onSubmit: (body: CreateAttendeeBody) => Promise<{ error?: string | null }>;
  onCancel: () => void;
}

const STATUSES: AttendeeStatus[] = ["REGISTERED", "CANCELLED", "CHECKED_IN", "REFUNDED"];

export function AttendeeForm({ ticketTypes, initialData, onSubmit, onCancel }: AttendeeFormProps) {
  const id = useId();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState(initialData?.email ?? "");
  const [name, setName] = useState(initialData?.name ?? "");
  const [phone, setPhone] = useState(initialData?.phone ?? "");
  const [ticketTypeId, setTicketTypeId] = useState(initialData?.ticketTypeId ?? "");
  const [status, setStatus] = useState<AttendeeStatus>(initialData?.status ?? "REGISTERED");

  const emailId = `${id}-email`;
  const nameId = `${id}-name`;
  const phoneId = `${id}-phone`;
  const ticketTypeIdId = `${id}-ticket-type`;
  const statusId = `${id}-status`;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email.trim()) {
      setError("Email is required");
      return;
    }

    const body: CreateAttendeeBody = {
      email: email.trim(),
      name: name.trim() || undefined,
      phone: phone.trim() || undefined,
      ticketTypeId: ticketTypeId || null,
      status,
    };

    setSaving(true);
    try {
      const result = await onSubmit(body);
      if (result.error) {
        setError(result.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save attendee");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border border-border bg-card p-5 space-y-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-heading font-semibold text-foreground flex items-center gap-2">
          <User className="w-4 h-4 text-primary" />
          {initialData ? "Edit attendee" : "New attendee"}
        </h3>
        <button type="button" onClick={onCancel} className="p-1.5 rounded-lg hover:bg-muted transition-colors" aria-label="Cancel">
          <X className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>

      {error && <div className="rounded-xl bg-rose-50 text-rose-800 text-sm px-3 py-2 border border-rose-200">{error}</div>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label htmlFor={emailId} className="text-caption font-semibold text-muted-foreground uppercase tracking-wide">Email *</label>
          <input
            id={emailId}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="attendee@example.com"
            className="w-full h-10 px-3 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={nameId} className="text-caption font-semibold text-muted-foreground uppercase tracking-wide">Name</label>
          <input
            id={nameId}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name"
            className="w-full h-10 px-3 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label htmlFor={phoneId} className="text-caption font-semibold text-muted-foreground uppercase tracking-wide">Phone</label>
          <input
            id={phoneId}
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+1 234 567 8900"
            className="w-full h-10 px-3 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={ticketTypeIdId} className="text-caption font-semibold text-muted-foreground uppercase tracking-wide">Ticket type</label>
          <select
            id={ticketTypeIdId}
            value={ticketTypeId}
            onChange={(e) => setTicketTypeId(e.target.value)}
            className="w-full h-10 px-3 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30"
          >
            <option value="">No ticket type</option>
            {ticketTypes.map((tt) => (
              <option key={tt.id} value={tt.id}>
                {tt.name} — {parseFloat(tt.price).toFixed(2)} {tt.currency}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor={statusId} className="text-caption font-semibold text-muted-foreground uppercase tracking-wide">Status</label>
        <select
          id={statusId}
          value={status}
          onChange={(e) => setStatus(e.target.value as AttendeeStatus)}
          className="w-full h-10 px-3 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace("_", " ")}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" isLoading={saving} leftIcon={<Save className="w-4 h-4" />}>
          Save
        </Button>
      </div>
    </form>
  );
}
