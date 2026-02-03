"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Button, Card, Input } from "@keyflow/ui";
import { apiGet, apiPost, API_BASE } from "@/lib/api";
import { Calendar, Clock, User, CheckCircle2, Loader2 } from "lucide-react";

type Business = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  currency: string;
};

type Service = {
  id: string;
  name: string;
  durationMins: number;
  price: number;
  currency: string;
};

type Staff = {
  id: string;
  name: string;
};

export default function PublicBookingPage() {
  const params = useParams();
  const slug = params.slug as string;

  const [business, setBusiness] = useState<Business | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedService, setSelectedService] = useState<string>("");
  const [selectedStaff, setSelectedStaff] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [selectedTime, setSelectedTime] = useState<string>("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [bookingResult, setBookingResult] = useState<{ bookingId: string; invoiceId?: string } | null>(null);

  useEffect(() => {
    const loadBusiness = async () => {
      setLoading(true);
      const res = await apiGet<Business>(`/identity/businesses/slug/${encodeURIComponent(slug)}`);
      if (res.error || !res.data) {
        setError("Business not found");
        setLoading(false);
        return;
      }
      setBusiness(res.data);
      
      const [servicesRes, staffRes] = await Promise.all([
        apiGet<Service[]>(`/bookings/businesses/${res.data.id}/services`),
        apiGet<Staff[]>(`/bookings/businesses/${res.data.id}/staff`),
      ]);
      setServices(servicesRes.data ?? []);
      setStaff(staffRes.data ?? []);
      if (servicesRes.data?.length) setSelectedService(servicesRes.data[0].id);
      if (staffRes.data?.length) setSelectedStaff(staffRes.data[0].id);
      setLoading(false);
    };
    loadBusiness();
  }, [slug]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business || !selectedService || !selectedDate || !selectedTime) return;

    setSubmitting(true);
    const startTime = new Date(`${selectedDate}T${selectedTime}`).toISOString();
    const service = services.find((s) => s.id === selectedService);
    const endTime = new Date(new Date(startTime).getTime() + (service?.durationMins ?? 60) * 60000).toISOString();

    const { data, error } = await apiPost<{ bookingId: string; invoiceId?: string; success: boolean }>({
      path: `/bookings/public/businesses/${business.id}`,
      body: {
        serviceId: selectedService,
        staffId: selectedStaff || undefined,
        startTime,
        endTime,
        firstName: firstName || undefined,
        lastName: lastName || undefined,
        email: email || undefined,
        phone: phone || undefined,
      },
    });

    setSubmitting(false);
    if (error) {
      setError(error);
    } else if (data) {
      setSuccess(true);
      setBookingResult({ bookingId: data.bookingId, invoiceId: data.invoiceId });
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-black to-slate-950 text-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </main>
    );
  }

  if (error && !business) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-black to-slate-950 text-white flex items-center justify-center">
        <Card className="max-w-md bg-slate-900/80 border-red-500/40">
          <div className="text-center p-6">
            <h1 className="text-xl font-semibold text-red-400">Business Not Found</h1>
            <p className="text-sm text-slate-400 mt-2">The booking page for "{slug}" could not be found.</p>
          </div>
        </Card>
      </main>
    );
  }

  if (success && bookingResult) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-black to-slate-950 text-white flex items-center justify-center px-4">
        <Card className="max-w-md bg-slate-900/80 border-emerald-500/40">
          <div className="text-center p-6 space-y-4">
            <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8 text-emerald-400" />
            </div>
            <h1 className="text-xl font-semibold text-emerald-400">Booking Confirmed!</h1>
            <p className="text-sm text-slate-300">
              Your appointment with {business?.name} has been scheduled.
            </p>
            <div className="text-xs text-slate-400 space-y-1">
              <div>Booking ID: <code className="font-mono text-primary">{bookingResult.bookingId}</code></div>
              {bookingResult.invoiceId && (
                <div>Invoice ID: <code className="font-mono text-primary">{bookingResult.invoiceId}</code></div>
              )}
            </div>
            {bookingResult.invoiceId && (
              <Button
                onClick={() => window.open(`${API_BASE}/commerce/invoices/${bookingResult.invoiceId}/receipt`, "_blank")}
              >
                View Invoice
              </Button>
            )}
          </div>
        </Card>
      </main>
    );
  }

  const selectedServiceData = services.find((s) => s.id === selectedService);

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-black to-slate-950 text-white px-4 py-10">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-semibold">{business?.name}</h1>
          <p className="text-sm text-slate-400">Book your appointment online</p>
        </div>

        <Card className="bg-slate-900/80 border-border/60">
          <form onSubmit={handleSubmit} className="space-y-6 p-2">
            <div className="space-y-3">
              <label className="block text-sm">
                <div className="flex items-center gap-2 text-muted-foreground mb-2">
                  <Calendar className="w-4 h-4" /> Select Service
                </div>
                <div className="grid gap-2">
                  {services.map((service) => (
                    <button
                      key={service.id}
                      type="button"
                      onClick={() => setSelectedService(service.id)}
                      className={`text-left rounded-xl border p-3 transition-colors ${
                        selectedService === service.id
                          ? "border-primary bg-primary/10"
                          : "border-border/60 hover:border-primary/40"
                      }`}
                    >
                      <div className="font-medium">{service.name}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-3 mt-1">
                        <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {service.durationMins} min</span>
                        <span>{service.currency} {service.price.toLocaleString()}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </label>
            </div>

            {staff.length > 0 && (
              <div className="space-y-3">
                <label className="block text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground mb-2">
                    <User className="w-4 h-4" /> Select Staff (Optional)
                  </div>
                  <select
                    className="w-full rounded-xl border border-border/60 bg-slate-950 px-3 py-2 text-sm"
                    value={selectedStaff}
                    onChange={(e) => setSelectedStaff(e.target.value)}
                  >
                    <option value="">Any available</option>
                    {staff.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Date"
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                required
              />
              <Input
                label="Time"
                type="time"
                value={selectedTime}
                onChange={(e) => setSelectedTime(e.target.value)}
                required
              />
            </div>

            <div className="border-t border-border/60 pt-4 space-y-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Your Details</div>
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="First Name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                />
                <Input
                  label="Last Name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                <Input
                  label="Phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 868 123 4567"
                />
              </div>
            </div>

            {selectedServiceData && (
              <div className="rounded-xl bg-primary/5 border border-primary/20 p-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Service:</span>
                  <span>{selectedServiceData.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Duration:</span>
                  <span>{selectedServiceData.durationMins} min</span>
                </div>
                <div className="flex justify-between font-semibold text-primary">
                  <span>Total:</span>
                  <span>{selectedServiceData.currency} {selectedServiceData.price.toLocaleString()}</span>
                </div>
              </div>
            )}

            {error && (
              <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {error}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={submitting || !selectedService || !selectedDate || !selectedTime}>
              {submitting ? "Booking..." : "Book Appointment"}
            </Button>
          </form>
        </Card>

        <div className="text-center text-xs text-muted-foreground">
          Powered by <span className="text-primary font-semibold">KeyFlowOS</span>
        </div>
      </div>
    </main>
  );
}
