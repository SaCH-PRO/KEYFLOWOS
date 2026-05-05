"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Button, Card, Badge } from "@keyflow/ui";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  XCircle,
} from "lucide-react";
import {
  acceptPublicQuote,
  fetchPublicQuote,
  rejectPublicQuote,
  type Quote,
} from "@/lib/client";
import { initPresence, trackPageView, pickBusinessId } from "@/app/_lib/presence-sdk";
import { API_BASE } from "@/lib/api";

type RespondState = "idle" | "submitting" | "done" | "error";

function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { dateStyle: "medium" });
}

const LIFECYCLE_STEPS: Array<{ key: string; label: string }> = [
  { key: "DRAFT", label: "Drafted" },
  { key: "SENT", label: "Sent" },
  { key: "VIEWED", label: "Viewed" },
  { key: "ACCEPTED", label: "Accepted" },
  { key: "INVOICED", label: "Invoiced" },
  { key: "PAID", label: "Paid" },
];

function LifecycleBar({ step }: { step: string }) {
  const idx = LIFECYCLE_STEPS.findIndex((s) => s.key === step);
  const isRejected = step === "REJECTED";
  return (
    <div className="flex items-center gap-2 flex-wrap text-[11px]">
      {LIFECYCLE_STEPS.map((s, i) => {
        const active = i === idx;
        const past = idx >= 0 && i < idx;
        return (
          <span
            key={s.key}
            className={`px-2 py-0.5 rounded-md font-semibold border transition-all ${
              active
                ? "bg-violet-500/20 text-violet-200 border-violet-400/40"
                : past
                  ? "text-violet-300/70 border-transparent"
                  : "text-slate-400/60 border-transparent"
            }`}
          >
            {s.label}
          </span>
        );
      })}
      {isRejected && (
        <span className="px-2 py-0.5 rounded-md font-semibold border bg-red-500/20 text-red-200 border-red-400/40">
          Rejected
        </span>
      )}
    </div>
  );
}

export default function PublicQuotePage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? "";
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    initPresence({ apiBase: API_BASE });
    const bizId = pickBusinessId(quote);
    if (bizId) trackPageView(bizId);
  }, [quote]);
  const [error, setError] = useState<string | null>(null);
  const [respondState, setRespondState] = useState<RespondState>("idle");
  const [respondError, setRespondError] = useState<string | null>(null);
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetchPublicQuote(token)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) {
          setError(error || "Quote not found.");
        } else {
          setQuote(data);
        }
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load quote.");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const onAccept = async () => {
    if (!token) return;
    setRespondState("submitting");
    setRespondError(null);
    const { data, error } = await acceptPublicQuote(token);
    if (error || !data) {
      setRespondState("error");
      setRespondError(error || "Failed to accept quote.");
      return;
    }
    setQuote((prev) => (prev ? { ...prev, ...data } : data));
    setRespondState("done");
  };

  const onReject = async () => {
    if (!token) return;
    setRespondState("submitting");
    setRespondError(null);
    const { data, error } = await rejectPublicQuote(token, rejectReason || undefined);
    if (error || !data) {
      setRespondState("error");
      setRespondError(error || "Failed to reject quote.");
      return;
    }
    setQuote((prev) => (prev ? { ...prev, ...data } : data));
    setRespondState("done");
    setShowRejectForm(false);
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-black to-slate-950 text-white flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-violet-300" />
      </main>
    );
  }

  if (error || !quote) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-black to-slate-950 text-white px-4 py-10">
        <div className="mx-auto max-w-xl">
          <Card className="bg-[rgba(0,0,0,0.35)] border border-[var(--kf-border)]">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-6 h-6 text-amber-300" />
              <div>
                <h1 className="text-lg font-semibold">Quote unavailable</h1>
                <p className="text-sm text-slate-300 mt-1">
                  {error ?? "This quote link is invalid or has been revoked."}
                </p>
              </div>
            </div>
          </Card>
        </div>
      </main>
    );
  }

  const decided = quote.status === "ACCEPTED" || quote.status === "REJECTED";
  const expired = !!quote.isExpired;
  const converted = !!quote.invoiceId;
  const canRespond = !decided && !expired && !converted;

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-black to-slate-950 text-white px-4 py-10">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex flex-col gap-2">
          <Badge tone="info">Quote</Badge>
          <h1 className="text-3xl font-semibold flex items-center gap-2">
            <FileText className="w-6 h-6 text-violet-300" />
            #{quote.quoteNumber}
          </h1>
          <LifecycleBar step={quote.lifecycleStep ?? quote.status} />
        </div>

        {(expired || converted || decided) && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border px-4 py-3 text-sm flex items-start gap-2"
            style={{
              borderColor: converted
                ? "rgba(16,185,129,0.4)"
                : expired
                  ? "rgba(245,158,11,0.4)"
                  : quote.status === "ACCEPTED"
                    ? "rgba(16,185,129,0.4)"
                    : "rgba(248,113,113,0.4)",
              background: converted
                ? "rgba(16,185,129,0.08)"
                : expired
                  ? "rgba(245,158,11,0.08)"
                  : quote.status === "ACCEPTED"
                    ? "rgba(16,185,129,0.08)"
                    : "rgba(248,113,113,0.08)",
            }}
          >
            {converted ? (
              <>
                <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-300" />
                <span>This quote has been converted to an invoice. No further action needed.</span>
              </>
            ) : expired ? (
              <>
                <Clock className="w-4 h-4 mt-0.5 text-amber-300" />
                <span>
                  This quote expired on {formatDate(quote.expiryDate)} and can no longer be accepted.
                </span>
              </>
            ) : quote.status === "ACCEPTED" ? (
              <>
                <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-300" />
                <span>You accepted this quote on {formatDate(quote.acceptedAt)}. Thanks!</span>
              </>
            ) : (
              <>
                <XCircle className="w-4 h-4 mt-0.5 text-red-300" />
                <span>You declined this quote on {formatDate(quote.rejectedAt)}.</span>
              </>
            )}
          </motion.div>
        )}

        <Card className="bg-[rgba(0,0,0,0.35)] border border-[var(--kf-border)]">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-slate-400">Issued</div>
              <div className="font-medium">{formatDate(quote.issueDate)}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-slate-400">Expires</div>
              <div className="font-medium">{formatDate(quote.expiryDate)}</div>
            </div>
            <div className="col-span-2">
              <div className="text-[11px] uppercase tracking-wide text-slate-400">Prepared for</div>
              <div className="font-medium">
                {quote.contact?.firstName ?? ""} {quote.contact?.lastName ?? ""}
                {quote.contact?.email ? (
                  <span className="text-slate-400 font-normal"> · {quote.contact.email}</span>
                ) : null}
              </div>
            </div>
          </div>

          <div className="mt-5 border-t border-white/5 pt-4">
            <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-2">Items</div>
            <div className="space-y-2">
              {(quote.items ?? []).map((item, i) => (
                <div key={item.id ?? i} className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{item.description}</div>
                    <div className="text-xs text-slate-400">
                      {item.quantity} × {formatMoney(item.unitPrice, quote.currency)}
                    </div>
                  </div>
                  <div className="font-semibold whitespace-nowrap">
                    {formatMoney(item.total, quote.currency)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-5 border-t border-white/5 pt-4 flex items-center justify-between">
            <span className="text-sm text-slate-300">Total</span>
            <span className="text-2xl font-bold text-white">
              {formatMoney(Number(quote.total), quote.currency)}
            </span>
          </div>

          {quote.notes && (
            <div className="mt-4 rounded-xl bg-white/[0.03] border border-white/5 px-3 py-2 text-sm text-slate-300 whitespace-pre-wrap">
              {quote.notes}
            </div>
          )}
        </Card>

        {canRespond && (
          <Card className="bg-[rgba(0,0,0,0.35)] border border-[var(--kf-border)]">
            {!showRejectForm ? (
              <div className="flex flex-col sm:flex-row gap-3">
                <Button
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 gap-2"
                  onClick={onAccept}
                  disabled={respondState === "submitting"}
                >
                  {respondState === "submitting" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  Accept Quote
                </Button>
                <Button
                  className="flex-1 bg-red-600/80 hover:bg-red-600 gap-2"
                  onClick={() => setShowRejectForm(true)}
                  disabled={respondState === "submitting"}
                >
                  <XCircle className="w-4 h-4" />
                  Decline
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <label className="text-sm text-slate-300 block">
                  Reason for declining (optional)
                  <textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    rows={3}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-red-400/50"
                    placeholder="Let them know why…"
                  />
                </label>
                <div className="flex gap-2">
                  <Button
                    className="flex-1 bg-red-600/80 hover:bg-red-600"
                    onClick={onReject}
                    disabled={respondState === "submitting"}
                  >
                    {respondState === "submitting" ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      "Confirm decline"
                    )}
                  </Button>
                  <Button
                    className="bg-white/5 hover:bg-white/10"
                    onClick={() => {
                      setShowRejectForm(false);
                      setRejectReason("");
                    }}
                    disabled={respondState === "submitting"}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
            {respondError && (
              <p className="mt-3 text-sm text-red-300">{respondError}</p>
            )}
          </Card>
        )}
      </div>
    </main>
  );
}
