'use client';

import { useState } from "react";
import { Button, Card, Input, Badge } from "@keyflow/ui";
import { DEFAULT_BUSINESS_ID } from "@/lib/client";
import { motion } from "framer-motion";
import { PresenceTracker } from "@/app/_lib/PresenceTracker";

export default function PublicPayPage() {
  const [invoiceId, setInvoiceId] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const goToPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invoiceId.trim()) {
      setStatus("Please enter an invoice ID.");
      return;
    }
    window.location.href = `/pay/${encodeURIComponent(invoiceId.trim())}`;
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-black to-slate-950 text-white px-4 py-10">
      <PresenceTracker businessId={DEFAULT_BUSINESS_ID || null} />
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex flex-col gap-2">
          <Badge tone="info">Public Payment</Badge>
          <h1 className="text-3xl font-semibold">Pay Invoice</h1>
          <p className="text-sm text-slate-300">
            Enter an invoice ID to pay through the secure checkout flow.
          </p>
        </div>

        <Card title="Payment" badge="Live" className="bg-[rgba(0,0,0,0.35)] border border-[var(--kf-border)]">
          <form onSubmit={goToPayment} className="grid grid-cols-1 gap-4">
            <Input label="Invoice ID" value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} required placeholder="inv_xxx" />
            <div className="flex justify-end">
              <Button type="submit">Pay Invoice</Button>
            </div>
          </form>
          {status && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-3 rounded-2xl border border-amber-300/50 bg-amber-300/10 px-3 py-2 text-sm text-amber-100"
            >
              {status}
            </motion.div>
          )}
        </Card>
      </div>
    </main>
  );
}
