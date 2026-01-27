'use client';

import { useState } from 'react';
import { Button } from '@keyflow/ui';
import { apiPost } from '@/lib/api';

export default function BookPage() {
  const [businessId, setBusinessId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [staffId, setStaffId] = useState('');
  const [startTime, setStartTime] = useState('');
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('Submitting...');
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
        email: email || undefined,
        firstName: firstName || undefined,
      },
    });
    if (error) {
      setStatus(`Error: ${error}`);
    } else {
      setStatus(`Booked! bookingId=${data?.bookingId} invoiceId=${data?.invoiceId ?? 'none'}`);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background p-8 space-y-6 text-foreground">
      <div className="max-w-xl w-full space-y-4">
        <h1 className="text-3xl font-bold">Public Booking Test</h1>
        <p className="text-muted-foreground">
          Submit a booking to the Nest backend using the new public booking endpoint.
        </p>
        <form onSubmit={submit} className="grid grid-cols-1 gap-4">
          <input
            className="w-full rounded border border-border bg-background px-3 py-2 text-foreground placeholder:text-muted-foreground"
            placeholder="Business ID"
            value={businessId}
            onChange={(e) => setBusinessId(e.target.value)}
            required
          />
          <input
            className="w-full rounded border border-border bg-background px-3 py-2 text-foreground placeholder:text-muted-foreground"
            placeholder="Service ID"
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value)}
            required
          />
          <input
            className="w-full rounded border border-border bg-background px-3 py-2 text-foreground placeholder:text-muted-foreground"
            placeholder="Staff ID"
            value={staffId}
            onChange={(e) => setStaffId(e.target.value)}
            required
          />
          <input
            className="w-full rounded border border-border bg-background px-3 py-2 text-foreground placeholder:text-muted-foreground"
            placeholder="Start time (ISO)"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            required
          />
          <input
            className="w-full rounded border border-border bg-background px-3 py-2 text-foreground placeholder:text-muted-foreground"
            placeholder="First name (optional)"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
          />
          <input
            className="w-full rounded border border-border bg-background px-3 py-2 text-foreground placeholder:text-muted-foreground"
            placeholder="Email (optional)"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <div className="flex justify-end">
            <Button type="submit">Submit Booking</Button>
          </div>
        </form>
        {status && <p className="text-sm text-muted-foreground">{status}</p>}
      </div>
    </main>
  );
}
