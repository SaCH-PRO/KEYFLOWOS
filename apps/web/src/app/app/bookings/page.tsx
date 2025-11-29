"use client";

import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { Button, Input, Table } from "@keyflow/ui";
import { Booking, createBooking, fetchBookings } from "@/lib/client";

const bookingSchema = z.object({
  start: z.string().min(1, "Start time required"),
  end: z.string().min(1, "End time required"),
  serviceId: z.string().min(1, "Service required"),
  staffId: z.string().min(1, "Staff required"),
});

export default function BookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ start: "", end: "", serviceId: "svc_consult", staffId: "staff_ali" });
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data, error } = await fetchBookings();
      setBookings(data ?? []);
      setError(error);
      setLoading(false);
    };
    void load();
  }, []);

  const rows = useMemo(
    () =>
      bookings.map((b) => [
        new Date(b.startTime).toLocaleString(),
        new Date(b.endTime).toLocaleString(),
        b.status,
      ]),
    [bookings],
  );

  async function handleCreate() {
    setFormError(null);
    const parsed = bookingSchema.safeParse(form);
    if (!parsed.success) {
      setFormError(parsed.error.errors[0]?.message ?? "Invalid input");
      return;
    }
    const { data, error } = await createBooking({
      serviceId: parsed.data.serviceId,
      staffId: parsed.data.staffId,
      startTime: parsed.data.start,
      endTime: parsed.data.end,
    });
    if (error) setFormError(error);
    if (data) {
      setBookings((prev) => [data, ...prev]);
      setForm({ start: "", end: "", serviceId: "svc_consult", staffId: "staff_ali" });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Bookings</h1>
          <p className="text-sm text-muted-foreground">Schedule intelligence, services, and staff assignment.</p>
        </div>
        <div className="flex gap-2 items-end">
          <Input
            className="w-48"
            label="Start (ISO)"
            placeholder="2025-12-01T15:00:00Z"
            value={form.start}
            onChange={(e) => setForm((f) => ({ ...f, start: e.target.value }))}
          />
          <Input
            className="w-48"
            label="End (ISO)"
            placeholder="2025-12-01T16:00:00Z"
            value={form.end}
            onChange={(e) => setForm((f) => ({ ...f, end: e.target.value }))}
          />
          <Input
            className="w-36"
            label="Service ID"
            value={form.serviceId}
            onChange={(e) => setForm((f) => ({ ...f, serviceId: e.target.value }))}
          />
          <Input
            className="w-36"
            label="Staff ID"
            value={form.staffId}
            onChange={(e) => setForm((f) => ({ ...f, staffId: e.target.value }))}
          />
          <Button onClick={handleCreate}>Add</Button>
        </div>
      </div>

      {formError && <div className="text-xs text-amber-400">{formError}</div>}
      {error && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          Live API unreachable — showing demo data.
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-border/60 bg-slate-950/50 p-4 text-sm text-muted-foreground">
          {loading ? "Loading bookings..." : "No bookings yet. Add one to begin scheduling."}
        </div>
      ) : (
        <Table headers={["Start", "End", "Status"]} rows={rows} />
      )}
    </div>
  );
}
