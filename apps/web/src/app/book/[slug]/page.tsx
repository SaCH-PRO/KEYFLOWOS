"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Button, Card, Input } from "@keyflow/ui";
import { apiGet, apiPost, API_BASE } from "@/lib/api";
import { Calendar, Clock, User, CheckCircle2, Loader2, Briefcase, Phone, Mail, MapPin, Globe } from "lucide-react";

type Business = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  currency: string;
  logoUrl?: string | null;
  tagline?: string | null;
  description?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
};

type Service = {
  id: string;
  name: string;
  duration: number;
  durationMins?: number;
  price: number;
  currency?: string;
  description?: string | null;
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
      let res = await apiGet<Business>(`/identity/businesses/slug/${encodeURIComponent(slug)}`);
      if (res.error || !res.data) {
        res = await apiGet<Business>(`/identity/businesses/${encodeURIComponent(slug)}`);
      }
      if (res.error || !res.data) {
        setError("Business not found");
        setLoading(false);
        return;
      }
      setBusiness(res.data);
      
      const [servicesRes, staffRes] = await Promise.all([
        apiGet<Service[]>(`/bookings/public/businesses/${res.data.id}/services`),
        apiGet<Staff[]>(`/bookings/public/businesses/${res.data.id}/staff`),
      ]);
      setServices(servicesRes.data ?? []);
      setStaff(staffRes.data ?? []);
      if (servicesRes.data?.length) setSelectedService(servicesRes.data[0].id);
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
    const dur = service?.durationMins ?? service?.duration ?? 60;
    const endTime = new Date(new Date(startTime).getTime() + dur * 60000).toISOString();

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
        <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
      </main>
    );
  }

  if (error && !business) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-black to-slate-950 text-white flex items-center justify-center px-4">
        <div className="max-w-md w-full rounded-2xl border border-red-500/40 bg-slate-900/80 backdrop-blur p-8 text-center space-y-3">
          <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center mx-auto">
            <Globe className="w-7 h-7 text-red-400" />
          </div>
          <h1 className="text-xl font-semibold text-red-400">Page Not Found</h1>
          <p className="text-sm text-slate-400">The booking page for &ldquo;{slug}&rdquo; could not be found.</p>
        </div>
      </main>
    );
  }

  if (success && bookingResult) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-black to-slate-950 text-white flex items-center justify-center px-4">
        <div className="max-w-md w-full rounded-2xl border border-emerald-500/40 bg-slate-900/80 backdrop-blur p-8 text-center space-y-5">
          <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-8 h-8 text-emerald-400" />
          </div>
          <h1 className="text-xl font-semibold text-emerald-400">Booking Confirmed!</h1>
          <p className="text-sm text-slate-300">
            Your appointment with <span className="font-medium text-white">{business?.name}</span> has been scheduled.
          </p>
          <div className="text-xs text-slate-400 space-y-1">
            <div>Booking Reference: <code className="font-mono text-orange-400">{bookingResult.bookingId.slice(-8).toUpperCase()}</code></div>
          </div>
          {bookingResult.invoiceId && (
            <button
              onClick={() => window.open(`${API_BASE}/commerce/invoices/${bookingResult.invoiceId}/receipt`, "_blank")}
              className="px-6 py-2.5 rounded-xl bg-orange-500 text-white font-medium text-sm hover:bg-orange-600 transition-colors"
            >
              View Invoice
            </button>
          )}
        </div>
      </main>
    );
  }

  const selectedServiceData = services.find((s) => s.id === selectedService);
  const serviceDuration = selectedServiceData?.durationMins ?? selectedServiceData?.duration ?? 0;

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-black to-slate-950 text-white px-4 py-10">
      <div className="mx-auto max-w-2xl space-y-6">
        {/* Header */}
        <div className="text-center space-y-3">
          {business?.logoUrl && (
            <img src={business.logoUrl} alt={business.name} className="h-16 w-16 rounded-2xl mx-auto object-cover border border-slate-700/60" />
          )}
          <h1 className="text-3xl font-semibold">{business?.name}</h1>
          {business?.tagline && <p className="text-sm text-slate-400">{business.tagline}</p>}
          {!business?.tagline && <p className="text-sm text-slate-400">Book your appointment online</p>}
          {(business?.address || business?.phone || business?.email) && (
            <div className="flex items-center justify-center gap-4 text-xs text-slate-500 flex-wrap">
              {business?.address && (
                <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {business.address}</span>
              )}
              {business?.phone && (
                <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> {business.phone}</span>
              )}
              {business?.email && (
                <span className="flex items-center gap-1"><Mail className="w-3 h-3" /> {business.email}</span>
              )}
            </div>
          )}
        </div>

        {/* Booking Form */}
        <div className="rounded-2xl border border-slate-700/60 bg-slate-900/60 backdrop-blur">
          <form onSubmit={handleSubmit} className="p-5 space-y-6">
            {/* Services */}
            <div className="space-y-3">
              <div className="text-xs uppercase tracking-wide text-slate-500 flex items-center gap-2 px-1">
                <Briefcase className="w-3 h-3" /> Select a Service
              </div>
              <div className="space-y-2">
                {services.map((service) => (
                  <button
                    key={service.id}
                    type="button"
                    onClick={() => setSelectedService(service.id)}
                    className={`w-full text-left rounded-xl border p-4 transition-all ${
                      selectedService === service.id
                        ? "border-orange-500/40 bg-orange-500/5 ring-1 ring-orange-500/20"
                        : "border-slate-700/40 hover:border-orange-500/30"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium text-white">{service.name}</div>
                        {service.description && <div className="text-xs text-slate-400 mt-0.5">{service.description}</div>}
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-semibold text-orange-400">
                          {service.currency ?? "TTD"} {service.price.toLocaleString()}
                        </div>
                        <div className="text-xs text-slate-500 flex items-center gap-1 justify-end">
                          <Clock className="w-3 h-3" /> {service.durationMins ?? service.duration} min
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Staff */}
            {staff.length > 0 && (
              <div className="space-y-3">
                <div className="text-xs uppercase tracking-wide text-slate-500 flex items-center gap-2 px-1">
                  <User className="w-3 h-3" /> Select Staff (Optional)
                </div>
                <div className="flex gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setSelectedStaff("")}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors ${
                      !selectedStaff ? "border-orange-500/40 bg-orange-500/5" : "border-slate-700/40 hover:border-orange-500/30"
                    }`}
                  >
                    <User className="w-4 h-4 text-slate-400" />
                    <span className="text-white">Any available</span>
                  </button>
                  {staff.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSelectedStaff(s.id)}
                      className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors ${
                        selectedStaff === s.id ? "border-orange-500/40 bg-orange-500/5" : "border-slate-700/40 hover:border-orange-500/30"
                      }`}
                    >
                      <div className="h-6 w-6 rounded-full bg-teal-500/10 border border-teal-500/20 flex items-center justify-center text-xs font-bold text-teal-400">
                        {s.name.charAt(0).toUpperCase()}
                      </div>
                      <span className="text-white">{s.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Date & Time */}
            <div className="space-y-3">
              <div className="text-xs uppercase tracking-wide text-slate-500 flex items-center gap-2 px-1">
                <Calendar className="w-3 h-3" /> Pick Date & Time
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-500 mb-1.5 block">Date</label>
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    required
                    min={new Date().toISOString().split("T")[0]}
                    className="w-full rounded-xl border border-slate-700/40 bg-slate-950/80 px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-orange-500/50"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1.5 block">Time</label>
                  <input
                    type="time"
                    value={selectedTime}
                    onChange={(e) => setSelectedTime(e.target.value)}
                    required
                    className="w-full rounded-xl border border-slate-700/40 bg-slate-950/80 px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-orange-500/50"
                  />
                </div>
              </div>
            </div>

            {/* Customer Details */}
            <div className="border-t border-slate-700/40 pt-5 space-y-3">
              <div className="text-xs uppercase tracking-wide text-slate-500">Your Details</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-500 mb-1.5 block">First Name</label>
                  <input
                    type="text"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    required
                    className="w-full rounded-xl border border-slate-700/40 bg-slate-950/80 px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-orange-500/50"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1.5 block">Last Name</label>
                  <input
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="w-full rounded-xl border border-slate-700/40 bg-slate-950/80 px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-orange-500/50"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1.5 block">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full rounded-xl border border-slate-700/40 bg-slate-950/80 px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-orange-500/50"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1.5 block">Phone</label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+1 868 123 4567"
                    className="w-full rounded-xl border border-slate-700/40 bg-slate-950/80 px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-orange-500/50"
                  />
                </div>
              </div>
            </div>

            {/* Summary */}
            {selectedServiceData && (
              <div className="rounded-xl bg-orange-500/5 border border-orange-500/20 p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Service</span>
                  <span className="text-white font-medium">{selectedServiceData.name}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Duration</span>
                  <span className="text-white">{serviceDuration} min</span>
                </div>
                <div className="flex justify-between text-sm font-semibold">
                  <span className="text-orange-400">Total</span>
                  <span className="text-orange-400">{selectedServiceData.currency ?? "TTD"} {selectedServiceData.price.toLocaleString()}</span>
                </div>
              </div>
            )}

            {error && (
              <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2.5 text-sm text-red-300">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !selectedService || !selectedDate || !selectedTime}
              className="w-full py-3 rounded-xl bg-orange-500 text-white font-medium text-sm hover:bg-orange-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? "Booking..." : "Book Appointment"}
            </button>
          </form>
        </div>

        <div className="text-center text-xs text-slate-600">
          Powered by <span className="text-orange-500 font-semibold">KeyFlowOS</span>
        </div>
      </div>
    </main>
  );
}
