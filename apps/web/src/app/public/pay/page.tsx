"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button, Card, Input, Badge } from "@keyflow/ui";
import { API_BASE } from "@/lib/api";
import { fetchInvoicePublic, markInvoicePaidPublic, type Invoice } from "@/lib/client";
import { motion } from "framer-motion";

export default function PublicPayPage() {
  const searchParams = useSearchParams();
  const invoiceIdParam = searchParams?.get("invoiceId") ?? "";
  const [invoiceId, setInvoiceId] = useState(invoiceIdParam);
  const [status, setStatus] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [paidInvoiceId, setPaidInvoiceId] = useState<string | null>(null);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loadingInvoice, setLoadingInvoice] = useState(false);

  useEffect(() => {
    if (!invoiceId) return;
    setLoadingInvoice(true);
    fetchInvoicePublic(invoiceId)
      .then((res) => setInvoice(res.data ?? null))
      .finally(() => setLoadingInvoice(false));
  }, [invoiceId]);

  const activeInvoice = invoiceId && invoice ? (invoice.id === invoiceId ? invoice : null) : null;

  const markPaid = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("Marking paid...");
    setSuccess(false);
    setPaidInvoiceId(null);
    const { data, error } = await markInvoicePaidPublic(invoiceId);
    if (error) {
      setStatus(`Error: ${error}`);
    } else {
      setStatus(`Invoice ${data?.id ?? invoiceId} marked PAID.`);
      setSuccess(true);
      setPaidInvoiceId(data?.id ?? invoiceId);
    }
  };

  return (
    <main className="min-h-screen bg-background text-foreground px-4 py-10">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex flex-col gap-2">
          <Badge tone="info">Public Payment</Badge>
          <h1 className="text-3xl font-semibold">Pay Invoice</h1>
          <p className="text-sm text-muted-foreground">
            Minimalist payment UI with frosted glass. Calls the mark-paid endpoint at{" "}
            <code className="font-mono">{API_BASE}</code>.
          </p>
        </div>

        <Card title="Payment" badge="Live">
          <form onSubmit={markPaid} className="grid grid-cols-1 gap-4">
            <Input label="Invoice ID" value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} required placeholder="inv_xxx" />
            <div className="flex justify-end">
              <Button type="submit">Mark Paid</Button>
            </div>
          </form>
          <div className="mt-3 rounded-xl border border-border/60 bg-card px-3 py-2 text-xs text-muted-foreground">
            {loadingInvoice && <div>Loading invoice details...</div>}
            {!loadingInvoice && activeInvoice && (
              <>
                <div>Invoice: {activeInvoice.invoiceNumber ?? activeInvoice.id}</div>
                <div>
                  Total: {activeInvoice.currency ?? "TTD"} {activeInvoice.total ?? 0}
                </div>
                <div>Status: {activeInvoice.status}</div>
              </>
            )}
          </div>
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
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className={`rounded-2xl border px-3 py-2 text-sm ${
                  success ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-200" : "border-amber-300/50 bg-amber-300/10 text-amber-100"
                }`}
              >
                {status}
              </motion.div>
              {success && paidInvoiceId && (
                <div className="mt-2 text-xs text-muted-foreground space-y-1">
                  <div>
                    Invoice ID: <code className="font-mono">{paidInvoiceId}</code>
                  </div>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-full border border-primary/60 px-3 py-1 text-[11px] text-primary hover:bg-primary/10"
                        onClick={() => window.open(`${API_BASE}/commerce/public/invoices/${paidInvoiceId}/receipt`, "_blank")}
                  >
                    Download receipt
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-[11px] text-muted-foreground hover:border-primary/60 hover:text-primary"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(
                          `${window.location.origin}/commerce/public/invoices/${paidInvoiceId}/receipt`,
                        );
                        setCopyMsg("Receipt link copied");
                        setTimeout(() => setCopyMsg(null), 1500);
                      } catch {
                        setCopyMsg("Copy failed");
                      }
                    }}
                  >
                    Share receipt
                  </button>
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
