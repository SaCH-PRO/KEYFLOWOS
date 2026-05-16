"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Calculator, RefreshCw, FileCheck2, Banknote, Loader2, ChevronRight, Download, X, Mail, Send } from "lucide-react";
import { toast } from "sonner";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  fetchTaxLiabilities, recomputeTaxLiabilities,
  fileTaxLiability, payTaxLiability,
  fetchTaxContributingInvoices, downloadAccountantExport,
  fetchFinanceSettings, sendAccountantExportEmail,
  type TaxLiabilityRow, type TaxContributingInvoice,
} from "@/lib/client";
import { formatCurrency } from "@/lib/currency";

type Liab = TaxLiabilityRow;

const STATUS_STYLES: Record<string, string> = {
  OPEN: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
  FILED: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30",
  PAID: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  AMENDED: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30",
};

const TYPE_LABEL: Record<string, string> = {
  VAT: "VAT",
  SALES_TAX: "Sales Tax",
  BUSINESS_LEVY: "Business Levy",
  WITHHOLDING: "Withholding",
};

function num(v: string | number | null | undefined): number {
  if (v == null) return 0;
  return typeof v === "number" ? v : Number(v);
}

function fmtRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const sameYear = s.getUTCFullYear() === e.getUTCFullYear();
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", timeZone: "UTC" };
  return `${s.toLocaleDateString("en-US", opts)} – ${e.toLocaleDateString("en-US", { ...opts, year: sameYear ? undefined : "numeric" })}, ${e.getUTCFullYear()}`;
}

export default function FinanceTaxPage() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [items, setItems] = useState<Liab[]>([]);
  const [loading, setLoading] = useState(true);
  const [recomputing, setRecomputing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<Liab | null>(null);
  const [exporting, setExporting] = useState(false);
  const [emailModal, setEmailModal] = useState<{ start: string; end: string } | null>(null);
  const [defaultAccountantEmail, setDefaultAccountantEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!businessId) return;
    void (async () => {
      const r = await fetchFinanceSettings(businessId);
      if (r.data) setDefaultAccountantEmail(r.data.accountantEmail ?? null);
    })();
  }, [businessId]);

  useEffect(() => {
    setBusinessId(getStoredBusinessId());
  }, []);

  const load = useCallback(async (bid: string) => {
    const r = await fetchTaxLiabilities(bid);
    if (r.error) {
      toast.error(r.error);
      setLoading(false);
      return;
    }
    setItems(r.data?.items ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!businessId) return;
    setLoading(true);
    void load(businessId);
  }, [businessId, load]);

  const recompute = async () => {
    if (!businessId) return;
    setRecomputing(true);
    const r = await recomputeTaxLiabilities(businessId);
    setRecomputing(false);
    if (r.error) {
      toast.error(r.error);
      return;
    }
    toast.success(`Recomputed ${r.data?.computed.length ?? 0} period(s)`);
    void load(businessId);
  };

  const onFile = async (id: string) => {
    if (!businessId) return;
    setBusyId(id);
    const r = await fileTaxLiability(businessId, id, {});
    setBusyId(null);
    if (r.error) {
      toast.error(r.error);
      return;
    }
    toast.success("Marked as filed");
    void load(businessId);
  };

  const onPay = async (id: string) => {
    if (!businessId) return;
    if (!confirm("Post a tax payment? This will debit Tax Payable and credit Cash.")) return;
    setBusyId(id);
    const r = await payTaxLiability(businessId, id, {});
    setBusyId(null);
    if (r.error) {
      toast.error(r.error);
      return;
    }
    toast.success("Tax payment posted");
    void load(businessId);
  };

  const onExport = async () => {
    if (!businessId) return;
    const today = new Date();
    const start = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
    const end = new Date(Date.UTC(today.getUTCFullYear(), 11, 31));
    const startStr = start.toISOString().slice(0, 10);
    const endStr = end.toISOString().slice(0, 10);
    setExporting(true);
    try {
      const { blob, filename } = await downloadAccountantExport(businessId, startStr, endStr);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      toast.success("Accountant export downloaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const grouped = useMemo(() => {
    const open = items.filter((i) => i.status === "OPEN" || i.status === "AMENDED");
    const filed = items.filter((i) => i.status === "FILED");
    const paid = items.filter((i) => i.status === "PAID");
    return { open, filed, paid };
  }, [items]);

  if (!businessId) {
    return <p className="text-sm text-muted-foreground p-4">Loading workspace…</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <Calculator className="w-4 h-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold leading-tight">Tax centre</h2>
            <p className="text-xs text-muted-foreground">VAT and Business Levy rollups, file & pay, accountant exports.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={recompute}
            disabled={recomputing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/40 bg-card/50 px-2.5 py-1.5 text-xs font-medium hover:bg-card/80 transition-colors disabled:opacity-50"
          >
            {recomputing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Recompute current period
          </button>
          <button
            type="button"
            onClick={onExport}
            disabled={exporting}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-2.5 py-1.5 text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            Accountant export (YTD)
          </button>
          <button
            type="button"
            onClick={() => {
              const today = new Date();
              const start = new Date(Date.UTC(today.getUTCFullYear(), 0, 1)).toISOString().slice(0, 10);
              const end = new Date(Date.UTC(today.getUTCFullYear(), 11, 31)).toISOString().slice(0, 10);
              setEmailModal({ start, end });
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 text-primary px-2.5 py-1.5 text-xs font-medium hover:bg-primary/10 transition-colors"
          >
            <Mail className="w-3.5 h-3.5" />
            Send to accountant
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground p-4">Loading tax periods…</p>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/50 bg-card/30 p-8 text-center">
          <Calculator className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm font-medium">No tax periods yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Click &ldquo;Recompute current period&rdquo; to roll up VAT and Business Levy from your invoices.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <Section title="Open" rows={grouped.open} onFile={onFile} onPay={onPay} onView={setDrawer} busyId={busyId} />
          <Section title="Filed" rows={grouped.filed} onFile={onFile} onPay={onPay} onView={setDrawer} busyId={busyId} />
          <Section title="Paid" rows={grouped.paid} onFile={onFile} onPay={onPay} onView={setDrawer} busyId={busyId} collapsedByDefault />
        </div>
      )}

      {drawer && businessId && (
        <ContributingDrawer
          businessId={businessId}
          liability={drawer}
          onClose={() => setDrawer(null)}
          defaultAccountantEmail={defaultAccountantEmail}
          onSavedDefault={(v) => setDefaultAccountantEmail(v)}
        />
      )}

      {emailModal && businessId && (
        <SendToAccountantModal
          businessId={businessId}
          start={emailModal.start}
          end={emailModal.end}
          defaultEmail={defaultAccountantEmail}
          onClose={() => setEmailModal(null)}
          onSavedDefault={(v) => setDefaultAccountantEmail(v)}
        />
      )}
    </div>
  );
}

function SendToAccountantModal({
  businessId, start, end, defaultEmail, onClose, onSavedDefault,
}: {
  businessId: string;
  start: string;
  end: string;
  defaultEmail: string | null;
  onClose: () => void;
  onSavedDefault: (v: string | null) => void;
}) {
  const [to, setTo] = useState(defaultEmail ?? "");
  const [message, setMessage] = useState("");
  const [saveDefault, setSaveDefault] = useState(!defaultEmail);
  const [sending, setSending] = useState(false);

  const submit = async () => {
    if (!to.trim()) {
      toast.error("Recipient email is required");
      return;
    }
    setSending(true);
    const r = await sendAccountantExportEmail(businessId, {
      start, end,
      to: to.trim(),
      message: message.trim() || null,
      saveRecipient: saveDefault,
    });
    setSending(false);
    if (r.error) {
      toast.error(r.error);
      return;
    }
    toast.success(`Sent to ${r.data?.to ?? to.trim()}`);
    if (r.data?.savedAsDefault) onSavedDefault(r.data.to);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-md bg-background border border-border rounded-xl shadow-xl">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Mail className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold">Send accountant export</h3>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-card">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Sends the accountant export ZIP for <strong>{start}</strong> to <strong>{end}</strong> as an
            email attachment via Keyflow&apos;s mailer.
          </p>
          <label className="block">
            <span className="text-xs font-medium">Recipient email</span>
            <input
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="accountant@firm.com"
              className="mt-1 w-full rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-sm"
              autoFocus
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium">Cover note (optional)</span>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              placeholder="Hi — attached is the latest export for your review."
              className="mt-1 w-full rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-sm resize-none"
            />
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={saveDefault}
              onChange={(e) => setSaveDefault(e.target.checked)}
              className="rounded border-border"
            />
            Remember this as the default recipient
          </label>
        </div>
        <div className="px-4 py-3 border-t border-border flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border hover:bg-card"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={sending || !to.trim()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            Send email
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({
  title, rows, onFile, onPay, onView, busyId, collapsedByDefault,
}: {
  title: string;
  rows: Liab[];
  onFile: (id: string) => void;
  onPay: (id: string) => void;
  onView: (l: Liab) => void;
  busyId: string | null;
  collapsedByDefault?: boolean;
}) {
  const [open, setOpen] = useState(!collapsedByDefault);
  if (rows.length === 0 && collapsedByDefault) return null;
  return (
    <div className="rounded-xl border border-border/40 bg-card/40 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold border-b border-border/40 hover:bg-card/60"
      >
        <span>{title} <span className="text-muted-foreground font-normal">({rows.length})</span></span>
        <ChevronRight className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && rows.length === 0 && (
        <p className="text-xs text-muted-foreground p-3">No periods in this state.</p>
      )}
      {open && rows.length > 0 && (
        <div className="divide-y divide-border/40">
          {rows.map((r) => (
            <Row key={r.id} l={r} onFile={onFile} onPay={onPay} onView={onView} busy={busyId === r.id} />
          ))}
        </div>
      )}
    </div>
  );
}

function Row({
  l, onFile, onPay, onView, busy,
}: {
  l: Liab;
  onFile: (id: string) => void;
  onPay: (id: string) => void;
  onView: (l: Liab) => void;
  busy: boolean;
}) {
  const collected = num(l.taxCollected);
  const paid = num(l.taxPaid);
  const due = num(l.amountDue);
  return (
    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 px-3 py-3 items-center">
      <div className="flex items-center gap-3 min-w-0">
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${STATUS_STYLES[l.status] ?? "bg-muted text-muted-foreground border-border/40"}`}>
          {l.status}
        </span>
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">
            {TYPE_LABEL[l.type] ?? l.type}
            <span className="text-muted-foreground font-normal"> · {fmtRange(l.periodStart, l.periodEnd)}</span>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-3">
            <span>Sales: {formatCurrency(num(l.taxableSales))}</span>
            <span>Collected: {formatCurrency(collected)}</span>
            <span>Paid: {formatCurrency(paid)}</span>
            <span className="font-medium text-foreground">Due: {formatCurrency(due)}</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1.5 justify-end">
        <button
          type="button"
          onClick={() => onView(l)}
          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-border/40 hover:bg-card/80"
        >
          Drill down
        </button>
        {(l.status === "OPEN" || l.status === "AMENDED") && (
          <button
            type="button"
            onClick={() => onFile(l.id)}
            disabled={busy}
            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-blue-500/40 text-blue-600 dark:text-blue-400 hover:bg-blue-500/10 disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileCheck2 className="w-3 h-3" />}
            File
          </button>
        )}
        {l.status !== "PAID" && due > 0 && (
          <button
            type="button"
            onClick={() => onPay(l.id)}
            disabled={busy}
            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/40 hover:bg-emerald-500/20 disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Banknote className="w-3 h-3" />}
            Mark paid
          </button>
        )}
      </div>
    </div>
  );
}

async function exportLiability(businessId: string, liab: Liab) {
  const startStr = new Date(liab.periodStart).toISOString().slice(0, 10);
  const endStr = new Date(liab.periodEnd).toISOString().slice(0, 10);
  const { blob, filename } = await downloadAccountantExport(businessId, startStr, endStr);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function ContributingDrawer({
  businessId, liability, onClose, defaultAccountantEmail, onSavedDefault,
}: {
  businessId: string;
  liability: Liab;
  onClose: () => void;
  defaultAccountantEmail: string | null;
  onSavedDefault: (v: string | null) => void;
}) {
  const [invoices, setInvoices] = useState<TaxContributingInvoice[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [showSend, setShowSend] = useState(false);
  const periodStart = new Date(liability.periodStart).toISOString().slice(0, 10);
  const periodEnd = new Date(liability.periodEnd).toISOString().slice(0, 10);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const r = await fetchTaxContributingInvoices(businessId, liability.id);
      if (cancelled) return;
      if (r.error) {
        toast.error(r.error);
        setInvoices([]);
      } else {
        setInvoices(r.data?.invoices ?? []);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [businessId, liability.id]);

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-2xl bg-background border-l border-border shadow-xl overflow-y-auto">
        <div className="sticky top-0 bg-background border-b border-border px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground">{TYPE_LABEL[liability.type] ?? liability.type}</p>
            <h3 className="text-sm font-semibold">{fmtRange(liability.periodStart, liability.periodEnd)}</h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={async () => {
                if (downloading) return;
                setDownloading(true);
                try {
                  await exportLiability(businessId, liability);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Export failed");
                } finally {
                  setDownloading(false);
                }
              }}
              disabled={downloading}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border border-border hover:bg-card disabled:opacity-60"
              title="Download an Accountant Export ZIP scoped to this period"
            >
              {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              Export for Accountant
            </button>
            <button
              type="button"
              onClick={() => setShowSend(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border border-primary/40 text-primary hover:bg-primary/10"
              title="Email the accountant export ZIP for this period"
            >
              <Mail className="w-3.5 h-3.5" />
              Send to accountant
            </button>
            <button type="button" onClick={onClose} className="p-1 rounded hover:bg-card">
              <X className="w-4 h-4" />
            </button>
          </div>
          {showSend && (
            <SendToAccountantModal
              businessId={businessId}
              start={periodStart}
              end={periodEnd}
              defaultEmail={defaultAccountantEmail}
              onClose={() => setShowSend(false)}
              onSavedDefault={onSavedDefault}
            />
          )}
        </div>
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <Stat label="Taxable sales" value={formatCurrency(num(liability.taxableSales))} />
            <Stat label="Tax collected" value={formatCurrency(num(liability.taxCollected))} />
            <Stat label="Tax paid (purchases)" value={formatCurrency(num(liability.taxPaid))} />
            <Stat label="Amount due" value={formatCurrency(num(liability.amountDue))} highlight />
          </div>
          <div>
            <p className="text-xs font-semibold mb-2">Contributing invoices</p>
            {loading ? (
              <p className="text-xs text-muted-foreground">Loading…</p>
            ) : invoices && invoices.length === 0 ? (
              <p className="text-xs text-muted-foreground">No invoices contributed to this period.</p>
            ) : (
              <div className="rounded-lg border border-border/40 overflow-hidden">
                <div className="overflow-x-auto">
<table className="min-w-full w-full text-xs">
                  <thead className="bg-card/60">
                    <tr className="text-left">
                      <th className="px-2 py-1.5 font-medium">#</th>
                      <th className="px-2 py-1.5 font-medium">Customer</th>
                      <th className="px-2 py-1.5 font-medium">Paid</th>
                      <th className="px-2 py-1.5 font-medium text-right">Subtotal</th>
                      <th className="px-2 py-1.5 font-medium text-right">Tax</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {(invoices ?? []).map((inv) => {
                      const cn = inv.contact;
                      const name = cn?.displayName || `${cn?.firstName ?? ""} ${cn?.lastName ?? ""}`.trim() || cn?.email || "—";
                      return (
                        <tr key={inv.id}>
                          <td className="px-2 py-1.5 font-mono">{inv.invoiceNumber}</td>
                          <td className="px-2 py-1.5 truncate max-w-[140px]">{name}</td>
                          <td className="px-2 py-1.5 text-muted-foreground">{inv.paidAt ? new Date(inv.paidAt).toLocaleDateString() : "—"}</td>
                          <td className="px-2 py-1.5 text-right">{formatCurrency(num(inv.subtotal))}</td>
                          <td className="px-2 py-1.5 text-right">{formatCurrency(num(inv.taxAmount))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border p-2 ${highlight ? "border-primary/40 bg-primary/5" : "border-border/40 bg-card/40"}`}>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`text-sm font-semibold ${highlight ? "text-primary" : ""}`}>{value}</p>
    </div>
  );
}
