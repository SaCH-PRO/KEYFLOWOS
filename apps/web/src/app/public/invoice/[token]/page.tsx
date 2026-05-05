"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Badge, Button, Card } from "@keyflow/ui";
import { motion } from "framer-motion";
import { CheckCircle, Loader2, Mail, Phone, FileText, AlertCircle } from "lucide-react";
import { getPublicInvoiceByToken, type PublicInvoicePayload } from "@/lib/client";

function formatCurrency(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-TT", { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString("en-TT", { dateStyle: "medium" });
  } catch {
    return value;
  }
}

export default function PublicInvoicePage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? "";
  const [state, setState] = useState<{ loading: boolean; payload: PublicInvoicePayload | null; error: string | null }>({
    loading: true,
    payload: null,
    error: null,
  });

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await getPublicInvoiceByToken(token);
      if (cancelled) return;
      if (error || !data) {
        setState({ loading: false, payload: null, error: error ?? "Invoice not found" });
      } else {
        setState({ loading: false, payload: data, error: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (state.loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-black to-slate-950 text-white">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </main>
    );
  }

  if (state.error || !state.payload?.ok || !state.payload?.invoice) {
    const reason = state.payload?.reason;
    return (
      <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-black to-slate-950 text-white px-4">
        <Card className="max-w-md w-full p-8 text-center bg-card/80 border-border/50">
          <AlertCircle className="w-10 h-10 text-amber-400 mx-auto mb-4" />
          <h1 className="text-xl font-semibold mb-2">This invoice link is unavailable</h1>
          <p className="text-sm text-slate-400">
            {reason === "invalid_or_expired"
              ? "The link has expired or is invalid. Please request a new one from the sender."
              : state.error ?? "We couldn't find this invoice. Please double-check the link."}
          </p>
        </Card>
      </main>
    );
  }

  const invoice = state.payload.invoice;
  const business = invoice.business;
  const accent = business?.primaryColor || "#F97316";
  const isPaid = invoice.status === "PAID";
  const isVoid = invoice.status === "VOID";
  const contactName = invoice.contact
    ? [invoice.contact.firstName, invoice.contact.lastName].filter(Boolean).join(" ") || "Customer"
    : "Customer";

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-black to-slate-950 text-white px-4 py-10">
      <div className="mx-auto max-w-2xl space-y-6">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between gap-4"
        >
          <div className="flex items-center gap-3 min-w-0">
            {business?.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={business.logoUrl}
                alt={business.name}
                className="w-10 h-10 rounded-xl object-cover border border-border/40"
              />
            ) : (
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center font-semibold"
                style={{ backgroundColor: `${accent}22`, color: accent }}
              >
                {business?.name?.[0] ?? "K"}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wider text-slate-400">Invoice from</p>
              <p className="text-sm font-semibold truncate">{business?.name ?? "Business"}</p>
            </div>
          </div>
          <Badge tone={isPaid ? "success" : isVoid ? "danger" : "info"}>{invoice.status}</Badge>
        </motion.div>

        <Card className="p-6 bg-card/80 border-border/50 space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-wider text-slate-400">Invoice</p>
              <h1 className="text-2xl font-semibold">#{invoice.invoiceNumber}</h1>
              <p className="text-xs text-slate-400 mt-1">Billed to {contactName}</p>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-wider text-slate-400">Amount due</p>
              <p className="text-2xl font-semibold" style={{ color: accent }}>
                {formatCurrency(Number(invoice.total), invoice.currency)}
              </p>
              <p className="text-xs text-slate-400 mt-1">Due {formatDate(invoice.dueDate)}</p>
            </div>
          </div>

          {(invoice.items ?? []).length > 0 && (
            <div className="rounded-xl border border-border/40 overflow-hidden">
              <div className="grid grid-cols-12 gap-2 px-4 py-2 text-[10px] uppercase tracking-wider text-slate-500 bg-white/[0.02]">
                <div className="col-span-7">Description</div>
                <div className="col-span-2 text-right">Qty</div>
                <div className="col-span-3 text-right">Total</div>
              </div>
              <ul>
                {(invoice.items ?? []).map((item, idx) => (
                  <li
                    key={idx}
                    className="grid grid-cols-12 gap-2 px-4 py-2 text-sm border-t border-border/30"
                  >
                    <div className="col-span-7 truncate">{item.description}</div>
                    <div className="col-span-2 text-right text-slate-400">{item.quantity}</div>
                    <div className="col-span-3 text-right font-medium">
                      {formatCurrency(Number(item.total ?? item.quantity * item.unitPrice), invoice.currency)}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {invoice.notes && (
            <div className="rounded-xl bg-white/[0.03] border border-border/30 p-3">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-slate-400 mb-1">
                <FileText className="w-3 h-3" /> Notes
              </div>
              <p className="text-sm text-slate-200 whitespace-pre-wrap">{invoice.notes}</p>
            </div>
          )}

          {isPaid ? (
            <div className="flex items-center justify-center gap-2 rounded-xl py-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm font-medium">
              <CheckCircle className="w-4 h-4" /> This invoice has been paid in full.
            </div>
          ) : isVoid ? (
            <div className="flex items-center justify-center gap-2 rounded-xl py-3 bg-slate-500/10 border border-slate-500/30 text-slate-300 text-sm font-medium">
              This invoice has been voided.
            </div>
          ) : (
            <div className="space-y-3">
              <Button
                className="w-full"
                style={{ backgroundColor: accent }}
                onClick={() => {
                  // Tokenized provider-aware flow: /pay/link/{token} resolves
                  // the payment link on the API and forwards the customer to
                  // the appropriate provider checkout (Wipay / manual /
                  // gateway), avoiding the legacy mark-paid dropout.
                  window.location.href = `/pay/link/${encodeURIComponent(token)}`;
                }}
              >
                Pay this invoice
              </Button>
              <p className="text-xs text-center text-slate-400">
                Choose your payment option on the next screen.
              </p>
            </div>
          )}
        </Card>

        {(business?.email || business?.phone) && (
          <Card className="p-4 bg-card/60 border-border/40">
            <p className="text-xs uppercase tracking-wider text-slate-400 mb-2">
              Questions? Contact {business?.name}
            </p>
            <div className="flex flex-wrap gap-3 text-sm">
              {business?.email && (
                <a
                  href={`mailto:${business.email}`}
                  className="inline-flex items-center gap-1.5 text-slate-200 hover:text-white"
                >
                  <Mail className="w-3.5 h-3.5" /> {business.email}
                </a>
              )}
              {business?.phone && (
                <a
                  href={`tel:${business.phone}`}
                  className="inline-flex items-center gap-1.5 text-slate-200 hover:text-white"
                >
                  <Phone className="w-3.5 h-3.5" /> {business.phone}
                </a>
              )}
            </div>
          </Card>
        )}
      </div>
    </main>
  );
}
