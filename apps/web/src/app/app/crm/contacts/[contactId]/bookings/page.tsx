"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { fetchBookings } from "@/lib/client";
import { Card, Badge } from "@keyflow/ui";
import { Calendar, Clock, MapPin, User, CheckCircle, XCircle, AlertCircle } from "lucide-react";

interface Booking {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  notes?: string | null;
  location?: string | null;
  contact?: { firstName?: string | null; lastName?: string | null } | null;
  service?: { name: string; duration: number; price: number } | null;
  staff?: { name: string } | null;
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function fmtTime(d: string) {
  return new Date(d).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function isFutureDate(d: string) {
  return new Date(d).getTime() > Date.now();
}

export default function ContactBookingsPage() {
  const { contactId } = useParams();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const res = await fetchBookings();
      const all = (res.data ?? []) as Booking[];
      const filtered = all.filter((b) => (b as any).contactId === contactId);
      setBookings(filtered.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()));
      setLoading(false);
    };
    load();
  }, [contactId]);

  if (loading) return <div className="p-4">Loading bookings...</div>;

  const upcoming = bookings.filter((b) => isFutureDate(b.startTime));
  const past = bookings.filter((b) => !isFutureDate(b.startTime));

  const statusIcon = (status: string) => {
    const s = status.toLowerCase();
    if (s === "confirmed" || s === "completed") return <CheckCircle className="h-4 w-4 text-green-600" />;
    if (s === "cancelled") return <XCircle className="h-4 w-4 text-red-600" />;
    return <AlertCircle className="h-4 w-4 text-amber-600" />;
  };

  const statusBadge = (status: string) => {
    const s = status.toLowerCase();
    if (s === "confirmed" || s === "completed") return "bg-green-100 text-green-800";
    if (s === "cancelled") return "bg-red-100 text-red-800";
    if (s === "pending") return "bg-amber-100 text-amber-800";
    return "bg-gray-100 text-gray-800";
  };

  const BookingCard = ({ booking }: { booking: Booking }) => (
    <Card>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2">
              {statusIcon(booking.status)}
              <span className="font-medium">{booking.service?.name || "Booking"}</span>
              <span className={`rounded px-2 py-0.5 text-xs font-medium ${statusBadge(booking.status)}`}>{booking.status}</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" />
                {fmtDate(booking.startTime)}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                {fmtTime(booking.startTime)} - {fmtTime(booking.endTime)}
              </span>
              {booking.service && <span>{booking.service.duration} min · ${booking.service.price}</span>}
            </div>
            {booking.staff && (
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <User className="h-3.5 w-3.5" />
                {booking.staff.name}
              </div>
            )}
            {booking.location && (
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <MapPin className="h-3.5 w-3.5" />
                {booking.location}
              </div>
            )}
            {booking.notes && <p className="text-sm text-muted-foreground">{booking.notes}</p>}
          </div>
        </div>
      </div>
    </Card>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Calendar className="h-5 w-5 text-muted-foreground" />
        <h3 className="text-lg font-semibold">Bookings</h3>
        <span className="ml-auto text-sm text-muted-foreground">
          {upcoming.length} upcoming · {past.length} past
        </span>
      </div>

      {bookings.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          No bookings found for this contact.
        </div>
      ) : (
        <div className="space-y-4">
          {upcoming.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-primary">Upcoming</h4>
              {upcoming.map((b) => (
                <BookingCard key={b.id} booking={b} />
              ))}
            </div>
          )}
          {past.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-muted-foreground">Past</h4>
              {past.map((b) => (
                <BookingCard key={b.id} booking={b} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
