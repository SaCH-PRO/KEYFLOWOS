"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Input, Table, Badge } from "@keyflow/ui";
import {
  Availability,
  Booking,
  Contact,
  Service,
  StaffMember,
  createAvailability,
  createBooking,
  createService,
  createStaff,
  fetchAvailability,
  fetchBookings,
  fetchContacts,
  fetchServices,
  fetchStaff,
} from "@/lib/client";

const formatDate = (value?: string | null) => (value ? new Date(value).toLocaleString() : "-");
const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function BookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [availability, setAvailability] = useState<Availability[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [serviceForm, setServiceForm] = useState({ name: "", duration: "60", price: "0", currency: "TTD" });
  const [staffForm, setStaffForm] = useState({ name: "" });
  const [availabilityForm, setAvailabilityForm] = useState({ dayOfWeek: "1", startTime: "09:00", endTime: "17:00" });
  const [bookingForm, setBookingForm] = useState({
    contactId: "",
    serviceId: "",
    staffId: "",
    startTime: "",
    endTime: "",
  });

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const [bookingsRes, serviceRes, staffRes, contactsRes] = await Promise.all([
        fetchBookings(),
        fetchServices(),
        fetchStaff(),
        fetchContacts(undefined, { take: 50 }),
      ]);
      setBookings(bookingsRes.data ?? []);
      const serviceData = serviceRes.data ?? [];
      const staffData = staffRes.data ?? [];
      setServices(serviceData);
      setStaff(staffData);
      const contactData = contactsRes.data ?? [];
      setContacts(contactData);
      if (serviceData[0]?.id || staffData[0]?.id || contactData[0]?.id) {
        setBookingForm((prev) => ({
          ...prev,
          serviceId: prev.serviceId || serviceData[0]?.id || "",
          staffId: prev.staffId || staffData[0]?.id || "",
          contactId: prev.contactId || contactData[0]?.id || "",
        }));
      }
      setError(bookingsRes.error || serviceRes.error || staffRes.error || contactsRes.error);
      setLoading(false);
    };
    void load();
  }, []);

  useEffect(() => {
    if (!bookingForm.staffId) {
      setAvailability([]);
      return;
    }
    fetchAvailability(bookingForm.staffId).then(({ data }) => setAvailability(data ?? []));
  }, [bookingForm.staffId]);

  useEffect(() => {
    if (!bookingForm.startTime || !bookingForm.serviceId) return;
    const service = services.find((item) => item.id === bookingForm.serviceId);
    if (!service) return;
    const startDate = new Date(bookingForm.startTime);
    if (Number.isNaN(startDate.getTime())) return;
    const end = new Date(startDate.getTime() + service.duration * 60000);
    setBookingForm((prev) => ({ ...prev, endTime: end.toISOString().slice(0, 16) }));
  }, [bookingForm.startTime, bookingForm.serviceId, services]);

  const bookingRows = useMemo(
    () =>
      bookings.map((b) => [
        formatDate(b.startTime),
        formatDate(b.endTime),
        b.status,
        b.contact ? `${b.contact.firstName ?? ""} ${b.contact.lastName ?? ""}`.trim() || b.contact.email || "-" : "-",
        b.service?.name ?? "-",
        b.staff?.name ?? "-",
      ]),
    [bookings],
  );

  async function handleCreateBooking() {
    setFormError(null);
    if (!bookingForm.contactId || !bookingForm.serviceId || !bookingForm.staffId || !bookingForm.startTime) {
      setFormError("Select contact, service, staff, and start time.");
      return;
    }
    const res = await createBooking({
      contactId: bookingForm.contactId,
      serviceId: bookingForm.serviceId,
      staffId: bookingForm.staffId,
      startTime: bookingForm.startTime,
      endTime: bookingForm.endTime || bookingForm.startTime,
    });
    if (res.error) {
      setFormError(res.error);
      return;
    }
    if (res.data) {
      setBookings((prev) => [res.data as Booking, ...prev]);
      setBookingForm({ contactId: "", serviceId: "", staffId: "", startTime: "", endTime: "" });
    }
  }

  async function handleCreateService() {
    setFormError(null);
    if (!serviceForm.name.trim()) {
      setFormError("Service name required.");
      return;
    }
    const res = await createService({
      name: serviceForm.name.trim(),
      duration: Number(serviceForm.duration),
      price: Number(serviceForm.price),
      currency: serviceForm.currency,
    });
    if (res.data) {
      setServices((prev) => [res.data as Service, ...prev]);
      setServiceForm({ name: "", duration: "60", price: "0", currency: "TTD" });
    } else if (res.error) {
      setFormError(res.error);
    }
  }

  async function handleCreateStaff() {
    setFormError(null);
    if (!staffForm.name.trim()) {
      setFormError("Staff name required.");
      return;
    }
    const res = await createStaff({ name: staffForm.name.trim() });
    if (res.data) {
      setStaff((prev) => [res.data as StaffMember, ...prev]);
      setStaffForm({ name: "" });
    } else if (res.error) {
      setFormError(res.error);
    }
  }

  async function handleCreateAvailability() {
    setFormError(null);
    if (!bookingForm.staffId) {
      setFormError("Select a staff member first.");
      return;
    }
    const res = await createAvailability({
      staffId: bookingForm.staffId,
      dayOfWeek: Number(availabilityForm.dayOfWeek),
      startTime: availabilityForm.startTime,
      endTime: availabilityForm.endTime,
    });
    if (res.data) {
      setAvailability((prev) => [...prev, res.data as Availability]);
    } else if (res.error) {
      setFormError(res.error);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Bookings</h1>
          <p className="text-sm text-muted-foreground">Manage services, staff availability, and booking requests.</p>
        </div>
        <Badge tone="info">{bookings.length} bookings</Badge>
      </div>

      {formError && <div className="text-xs text-amber-400">{formError}</div>}
      {error && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          Live API unreachable — showing demo data.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-3xl border border-border/60 bg-slate-950/60 p-4">
          <div className="text-sm font-semibold">Create booking</div>
          <div className="grid gap-2 md:grid-cols-2">
            <label className="text-xs text-muted-foreground">
              Contact
              <select
                className="mt-1 w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
                value={bookingForm.contactId}
                onChange={(e) => setBookingForm((prev) => ({ ...prev, contactId: e.target.value }))}
              >
                <option value="">Select contact</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.displayName ||
                      `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() ||
                      c.email ||
                      "Unnamed"}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-muted-foreground">
              Service
              <select
                className="mt-1 w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
                value={bookingForm.serviceId}
                onChange={(e) => setBookingForm((prev) => ({ ...prev, serviceId: e.target.value }))}
              >
                <option value="">Select service</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.duration} min
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-muted-foreground">
              Staff
              <select
                className="mt-1 w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
                value={bookingForm.staffId}
                onChange={(e) => setBookingForm((prev) => ({ ...prev, staffId: e.target.value }))}
              >
                <option value="">Select staff</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <Input
              label="Start time"
              type="datetime-local"
              value={bookingForm.startTime}
              onChange={(e) => setBookingForm((prev) => ({ ...prev, startTime: e.target.value }))}
            />
            <Input
              label="End time"
              type="datetime-local"
              value={bookingForm.endTime}
              onChange={(e) => setBookingForm((prev) => ({ ...prev, endTime: e.target.value }))}
            />
          </div>
          <Button onClick={handleCreateBooking}>Save booking</Button>
        </div>

        <div className="space-y-3 rounded-3xl border border-border/60 bg-slate-950/60 p-4">
          <div className="text-sm font-semibold">Staff availability</div>
          <div className="text-xs text-muted-foreground">Select a staff member to add working hours.</div>
          <div className="grid gap-2 md:grid-cols-3">
            <select
              className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
              value={availabilityForm.dayOfWeek}
              onChange={(e) => setAvailabilityForm((prev) => ({ ...prev, dayOfWeek: e.target.value }))}
            >
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label, idx) => (
                <option key={label} value={idx}>
                  {label}
                </option>
              ))}
            </select>
            <Input
              label="Start"
              value={availabilityForm.startTime}
              onChange={(e) => setAvailabilityForm((prev) => ({ ...prev, startTime: e.target.value }))}
            />
            <Input
              label="End"
              value={availabilityForm.endTime}
              onChange={(e) => setAvailabilityForm((prev) => ({ ...prev, endTime: e.target.value }))}
            />
          </div>
          <Button variant="outline" onClick={handleCreateAvailability}>
            Add availability
          </Button>
          <div className="space-y-1 text-xs text-muted-foreground">
            {availability.length === 0 && <div>No availability logged yet.</div>}
            {availability.map((slot) => (
              <div key={slot.id} className="flex items-center justify-between">
                <span>
                  {dayLabels[slot.dayOfWeek] ?? slot.dayOfWeek} · {slot.startTime} - {slot.endTime}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-3xl border border-border/60 bg-slate-950/60 p-4">
          <div className="text-sm font-semibold">Services</div>
          <div className="grid gap-2 md:grid-cols-2">
            <Input
              label="Name"
              value={serviceForm.name}
              onChange={(e) => setServiceForm((prev) => ({ ...prev, name: e.target.value }))}
            />
            <Input
              label="Duration (min)"
              value={serviceForm.duration}
              onChange={(e) => setServiceForm((prev) => ({ ...prev, duration: e.target.value }))}
            />
            <Input
              label="Price"
              value={serviceForm.price}
              onChange={(e) => setServiceForm((prev) => ({ ...prev, price: e.target.value }))}
            />
            <Input
              label="Currency"
              value={serviceForm.currency}
              onChange={(e) => setServiceForm((prev) => ({ ...prev, currency: e.target.value }))}
            />
          </div>
          <Button variant="outline" onClick={handleCreateService}>
            Add service
          </Button>
          <div className="space-y-1 text-xs text-muted-foreground">
            {services.map((service) => (
              <div key={service.id} className="flex items-center justify-between">
                <span>
                  {service.name} · {service.duration} min
                </span>
                <span>
                  {service.currency ?? "TTD"} {service.price}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3 rounded-3xl border border-border/60 bg-slate-950/60 p-4">
          <div className="text-sm font-semibold">Staff</div>
          <div className="flex gap-2">
            <Input
              label="Name"
              value={staffForm.name}
              onChange={(e) => setStaffForm((prev) => ({ ...prev, name: e.target.value }))}
            />
            <Button variant="outline" onClick={handleCreateStaff}>
              Add staff
            </Button>
          </div>
          <div className="space-y-1 text-xs text-muted-foreground">
            {staff.map((member) => (
              <div key={member.id}>{member.name}</div>
            ))}
          </div>
        </div>
      </div>

      <div>
        {bookingRows.length === 0 ? (
          <div className="rounded-2xl border border-border/60 bg-slate-950/50 p-4 text-sm text-muted-foreground">
            {loading ? "Loading bookings..." : "No bookings yet. Add one to begin scheduling."}
          </div>
        ) : (
          <Table headers={["Start", "End", "Status", "Contact", "Service", "Staff"]} rows={bookingRows} />
        )}
      </div>
    </div>
  );
}
