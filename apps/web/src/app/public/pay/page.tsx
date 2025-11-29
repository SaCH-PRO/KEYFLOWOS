'use client';

import { useState } from "react";
import { Button, Card, Input, Badge } from "@keyflow/ui";
import { apiPost, API_BASE } from "@/lib/api";
import { motion } from "framer-motion";

export default function PublicPayPage() {
  const [invoiceId, setInvoiceId] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const markPaid = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("Marking paid...");
    setSuccess(false);
    const { data, error } = await apiPost<any>({
      path: `/commerce/invoices/${encodeURIComponent(invoiceId)}/paid`,
      body: {},
    });
    if (error) {
      setStatus(`Error: ${error}`);
    } else {
      setStatus(`Invoice ${data?.id ?? invoiceId} marked PAID.`);
      setSuccess(true);
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-black to-slate-950 text-white px-4 py-10">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex flex-col gap-2">
          <Badge tone="info">Public Payment</Badge>
          <h1 className="text-3xl font-semibold">Pay Invoice</h1>
          <p className="text-sm text-slate-300">
            Minimalist payment UI with frosted glass. Calls the mark-paid endpoint at{" "}
            <code className="font-mono">{API_BASE}</code>.
          </p>
        </div>

        <Card title="Payment" badge="Live" className="bg-[rgba(0,0,0,0.35)] border border-[var(--kf-border)]">
          <form onSubmit={markPaid} className="grid grid-cols-1 gap-4">
            <Input label="Invoice ID" value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} required placeholder="inv_xxx" />
            <div className="flex justify-end">
              <Button type="submit">Mark Paid</Button>
            </div>
          </form>
          {status && (
            <motion.p
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className={`mt-3 text-sm ${success ? "text-emerald-300" : "text-amber-200"}`}
            >
              {status}
            </motion.p>
          )}
        </Card>
      </div>
    </main>
  );
}
