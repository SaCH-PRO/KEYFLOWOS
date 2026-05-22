'use client';

import { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { apiGet, apiPost } from '@/lib/api';

interface Service {
  id: string;
  name: string;
  price: number;
  durationMinutes: number;
}

interface Staff {
  id: string;
  name: string;
}

export default function BookingWidgetPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const slug = params.slug as string;
  const theme = searchParams.get('theme') || 'dark';
  const primary = searchParams.get('primary') || '#f97316';

  const [step, setStep] = useState<'loading' | 'form' | 'success' | 'error'>('loading');
  const [services, setServices] = useState<Service[]>([]);
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [serviceId, setServiceId] = useState('');
  const [staffId, setStaffId] = useState('');
  const [startTime, setStartTime] = useState('');
  const [firstName, setFirstName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [result, setResult] = useState<{ bookingId?: string; invoiceId?: string } | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    apiGet<{ services?: Service[]; staff?: Staff[] }>(`/site/storefront/public/${encodeURIComponent(slug)}`)
      .then(({ data }) => {
        setServices(data?.services ?? []);
        setStaffList(data?.staff ?? []);
        setStep('form');
      })
      .catch(() => {
        setStep('error');
        setErrorMsg('Unable to load booking options.');
      });
  }, [slug]);

  useEffect(() => {
    if (step !== 'loading') {
      const h = document.body.scrollHeight;
      window.parent.postMessage({ type: 'KEYFLOW_WIDGET_RESIZE', height: h }, '*');
    }
  }, [step]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStep('loading');
    const { data, error } = await apiPost<{
      bookingId: string;
      invoiceId?: string;
      success: boolean;
    }>({
      path: `/bookings/public/businesses/${encodeURIComponent(slug)}`,
      body: { serviceId, staffId, startTime, firstName, email, phone },
    });
    if (error || !data?.success) {
      setStep('error');
      setErrorMsg(error || 'Booking failed. Please try again.');
    } else {
      setResult(data);
      setStep('success');
      notifyParent('booking:success', { bookingId: data.bookingId, invoiceId: data.invoiceId });
    }
  };

  const notifyParent = (eventName: string, payload: Record<string, unknown>) => {
    if (window.parent !== window) {
      window.parent.postMessage({ type: 'KEYFLOW_WIDGET_EVENT', eventName, payload }, '*');
    }
  };

  const isDark = theme === 'dark';
  const bg = isDark ? 'bg-slate-950 text-white' : 'bg-white text-slate-900';
  const card = isDark ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200';
  const input = isDark
    ? 'bg-white/5 border-white/10 text-white placeholder:text-white/40'
    : 'bg-white border-slate-300 text-slate-900 placeholder:text-slate-400';

  return (
    <div className={`min-h-screen w-full ${bg} px-4 py-6`}>
      <style>{`
        ::selection { background: ${primary}; color: white; }
      `}</style>

      <div className="mx-auto max-w-sm space-y-4">
        <div className="text-center">
          <h1 className="text-lg font-semibold">Book an Appointment</h1>
          <p className="text-xs opacity-60 mt-1">Powered by KeyflowOS</p>
        </div>

        {step === 'loading' && (
          <div className="flex justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent" style={{ color: primary }} />
          </div>
        )}

        {step === 'error' && (
          <div className={`rounded-xl border px-4 py-3 text-sm ${card}`}>
            <p className="text-red-400">{errorMsg}</p>
            <button onClick={() => setStep('form')} className="mt-2 text-sm underline" style={{ color: primary }}>
              Try again
            </button>
          </div>
        )}

        {step === 'success' && result && (
          <div className={`rounded-xl border px-4 py-4 text-center space-y-2 ${card}`}>
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: `${primary}20` }}>
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke={primary} strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="font-medium">Booking confirmed!</p>
            {result.bookingId && <p className="text-xs opacity-60">Booking ID: {result.bookingId}</p>}
            {result.invoiceId && (
              <a
                href={`/pay/${result.invoiceId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block mt-1 rounded-lg px-4 py-2 text-sm font-medium text-white"
                style={{ backgroundColor: primary }}
              >
                Pay Now
              </a>
            )}
          </div>
        )}

        {step === 'form' && (
          <form onSubmit={submit} className="space-y-3">
            <div className={`rounded-xl border p-3 space-y-3 ${card}`}>
              <label className="block text-xs font-medium opacity-70">Service</label>
              <select
                required
                value={serviceId}
                onChange={(e) => setServiceId(e.target.value)}
                className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-offset-0 ${input}`}
                style={{ '--tw-ring-color': primary } as React.CSSProperties}
              >
                <option value="">Select a service...</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · TTD {s.price}
                  </option>
                ))}
              </select>

              {staffList.length > 0 && (
                <>
                  <label className="block text-xs font-medium opacity-70">Staff</label>
                  <select
                    value={staffId}
                    onChange={(e) => setStaffId(e.target.value)}
                    className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-offset-0 ${input}`}
                    style={{ '--tw-ring-color': primary } as React.CSSProperties}
                  >
                    <option value="">Any available...</option>
                    {staffList.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </>
              )}

              <label className="block text-xs font-medium opacity-70">Date & Time</label>
              <input
                type="datetime-local"
                required
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-offset-0 ${input}`}
                style={{ '--tw-ring-color': primary } as React.CSSProperties}
              />

              <label className="block text-xs font-medium opacity-70">Your Name</label>
              <input
                type="text"
                required
                placeholder="John Doe"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-offset-0 ${input}`}
                style={{ '--tw-ring-color': primary } as React.CSSProperties}
              />

              <label className="block text-xs font-medium opacity-70">Email</label>
              <input
                type="email"
                required
                placeholder="john@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-offset-0 ${input}`}
                style={{ '--tw-ring-color': primary } as React.CSSProperties}
              />

              <label className="block text-xs font-medium opacity-70">Phone</label>
              <input
                type="tel"
                placeholder="868-123-4567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-offset-0 ${input}`}
                style={{ '--tw-ring-color': primary } as React.CSSProperties}
              />
            </div>

            <button
              type="submit"
              className="w-full rounded-lg py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: primary }}
            >
              Confirm Booking
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
