'use client';

import { useState } from "react";
import { Button, Card, Input, Badge } from "@keyflow/ui";
import { apiPost, API_BASE } from "@/lib/api";
import { DEFAULT_BUSINESS_ID } from "@/lib/client";
import { motion } from "framer-motion";

const serviceOptions = [
  { id: "svc_consult", label: "Consultation · TTD 500" },
  { id: "svc_follow", label: "Follow-up · TTD 300" },
];
const staffOptions = [
  { id: "staff_ali", label: "Dr. Ali" },
  { id: "staff_sam", label: "Sam · Coordinator" },
];

export default function PublicBookPage() {
  const [businessId, setBusinessId] = useState(DEFAULT_BUSINESS_ID);
  const [serviceId, setServiceId] = useState(serviceOptions[0]?.id ?? "");
  const [staffId, setStaffId] = useState(staffOptions[0]?.id ?? "");
  const [startTime, setStartTime] = useState("");
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("Submitting...");
    setSuccess(false);
    setBookingId(null);
    setInvoiceId(null);
    const { data, error } = await apiPost<{
      bookingId: string;
      invoiceId?: string;
      success: boolean;
    }>({
      path: `/bookings/public/businesses/${encodeURIComponent(businessId)}`,
      body: {
        serviceId,
        staffId,
        startTime,
        firstName: firstName || undefined,
        email: email || undefined,
      },
    });
    if (error) {
      setStatus(`Error: ${error}`);
    } else {
      setStatus(`Booked! bookingId=${data?.bookingId} invoiceId=${data?.invoiceId ?? "none"}`);
      setSuccess(true);
      setBookingId(data?.bookingId ?? null);
      setInvoiceId(data?.invoiceId ?? null);
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-black to-slate-950 text-white px-4 py-10">
      <div className="mx-auto max-w-5xl grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-4">
          <Badge tone="info">Public Booking</Badge>
          <h1 className="text-3xl font-semibold leading-tight">Book a session with KeyFlowOS</h1>
          <p className="text-sm text-slate-300">
            Premium, glassy public booking experience. Requests hit the live endpoint at{" "}
            <code className="font-mono">{API_BASE}</code>.
          </p>
          <div className="grid grid-cols-2 gap-3 text-sm text-slate-300">
            <div className="rounded-2xl border border-[var(--kf-border)] bg-[rgba(0,0,0,0.35)] p-3">
              <div className="text-xs uppercase tracking-[0.12em] text-[var(--kf-text-muted)]">Trust</div>
              <div className="mt-1 font-semibold">Secure & Encrypted</div>
            </div>
            <div className="rounded-2xl border border-[var(--kf-border)] bg-[rgba(0,0,0,0.35)] p-3">
              <div className="text-xs uppercase tracking-[0.12em] text-[var(--kf-text-muted)]">Speed</div>
              <div className="mt-1 font-semibold">Instant confirmation</div>
            </div>
          </div>
        </div>

        <Card title="Book Now" badge="Live" className="bg-[rgba(0,0,0,0.35)] border border-[var(--kf-border)]">
          <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input label="Business ID" value={businessId} onChange={(e) => setBusinessId(e.target.value)} required />
            <label className="flex flex-col gap-1 text-sm text-[var(--kf-text)]">
              <span className="text-xs text-[var(--kf-text-muted)]">Service</span>
              <select
                className="w-full rounded-lg bg-[var(--kf-glass)] border border-[var(--kf-border)] px-3 py-2 text-sm text-[var(--kf-text)]"
                value={serviceId}
                onChange={(e) => setServiceId(e.target.value)}
              >
                {serviceOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm text-[var(--kf-text)]">
              <span className="text-xs text-[var(--kf-text-muted)]">Staff</span>
              <select
                className="w-full rounded-lg bg-[var(--kf-glass)] border border-[var(--kf-border)] px-3 py-2 text-sm text-[var(--kf-text)]"
                value={staffId}
                onChange={(e) => setStaffId(e.target.value)}
              >
                {staffOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <Input
              label="Start Time (ISO)"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              required
              placeholder="2025-12-01T15:00:00Z"
            />
            <Input label="First Name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <div className="md:col-span-2 flex justify-end">
              <Button type="submit">Submit Booking</Button>
            </div>
          </form>
          {status && (
            <div className="relative mt-3">
              {success && (
                <motion.span
                  className="pointer-events-none absolute inset-0 rounded-2xl border border-emerald-400/50"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: [0.6, 0], scale: [1, 1.2] }}
                  transition={{ duration: 0.8, ease: "easeOut", repeat: 1 }}
                />
              )}
              <motion.p
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className={`text-sm ${success ? "text-emerald-300" : "text-amber-200"}`}
              >
                {status}
              </motion.p>
              {success && (
                <div className="mt-2 text-xs text-slate-200 space-y-1">
                  {bookingId && (
                    <div>
                      Booking ID: <code className="font-mono">{bookingId}</code>
                    </div>
                  )}
                  {invoiceId && (
                    <div>
                      Invoice ID: <code className="font-mono">{invoiceId}</code>
                    </div>
                  )}
                  <div className="flex gap-2">
                    {invoiceId && (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-full border border-primary/60 px-3 py-1 text-[11px] text-primary hover:bg-primary/10"
                        onClick={() => window.open(`${API_BASE}/commerce/invoices/${invoiceId}/receipt`, "_blank")}
                      >
                        View receipt
                      </button>
                    )}
                    {bookingId && (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-[11px] text-muted-foreground hover:border-primary/60 hover:text-primary"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(`${window.location.origin}/public/book?bookingId=${bookingId}`);
                            setCopyMsg("Link copied");
                            setTimeout(() => setCopyMsg(null), 1500);
                          } catch (err) {
                            setCopyMsg("Copy failed");
                          }
                        }}
                      >
                        Share booking
                      </button>
                    )}
                  </div>
                  {copyMsg && <div className="text-[11px] text-emerald-300">{copyMsg}</div>}
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </main>
  );
}
