"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, AlertCircle, Info, Check, X, RefreshCw, ArrowRight } from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import {
  fetchFinanceIntelActions,
  resolveFinanceIntelAction,
  dismissFinanceIntelAction,
  runFinanceIntelScan,
  type FinanceIntelActionItem,
} from "@/lib/client";

/**
 * FIN8 — "Needs Attention" panel. The daily insight strip is rendered
 * server-side by `_intel-strip-ssr.tsx`; this client panel handles the
 * action queue list (open scan, resolve, dismiss).
 */
export function FinanceIntelPanel({
  businessId,
  currency,
  compact = true,
}: {
  businessId: string;
  currency: string;
  compact?: boolean;
}) {
  const [items, setItems] = useState<FinanceIntelActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetchFinanceIntelActions(businessId, { status: "OPEN" });
    if (r.data) setItems(r.data.items);
    setLoading(false);
  }, [businessId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const onScan = useCallback(async () => {
    setScanning(true);
    await runFinanceIntelScan(businessId);
    await load();
    setScanning(false);
  }, [businessId, load]);

  const onResolve = useCallback(async (id: string) => {
    setBusyId(id);
    const r = await resolveFinanceIntelAction(businessId, id);
    if (!r.error) setItems((cur) => cur.filter((x) => x.id !== id));
    setBusyId(null);
  }, [businessId]);

  const onDismiss = useCallback(async (id: string) => {
    setBusyId(id);
    const r = await dismissFinanceIntelAction(businessId, id);
    if (!r.error) setItems((cur) => cur.filter((x) => x.id !== id));
    setBusyId(null);
  }, [businessId]);

  const visible = compact ? items.slice(0, 5) : items;
  // Group by severity so the highest-priority items always sit at the
  // top under their own header.
  const groups = (
    [
      { severity: "CRITICAL" as const, label: "Critical", items: visible.filter((i) => i.severity === "CRITICAL") },
      { severity: "WARNING" as const, label: "Warning", items: visible.filter((i) => i.severity === "WARNING") },
      { severity: "INFO" as const, label: "Info", items: visible.filter((i) => i.severity === "INFO" || (i.severity !== "CRITICAL" && i.severity !== "WARNING")) },
    ] as Array<{ severity: "CRITICAL" | "WARNING" | "INFO"; label: string; items: FinanceIntelActionItem[] }>
  ).filter((g) => g.items.length > 0);

  return (
    <div className="rounded-xl border border-border/40 bg-card/40 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold">Needs attention</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={onScan}
            disabled={scanning}
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 disabled:opacity-50"
            aria-label="Run finance scan"
          >
            <RefreshCw className={`w-3 h-3 ${scanning ? "animate-spin" : ""}`} /> Scan
          </button>
          {compact && (
            <Link href="/app/finance/actions" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
              See all <ArrowRight className="w-3 h-3" />
            </Link>
          )}
        </div>
      </div>

      {loading ? (
        <ul className="space-y-2" role="status" aria-label="Loading">
          {Array.from({ length: 3 }).map((_, i) => (
            <li key={i} className="h-12 rounded-lg bg-muted/30 animate-pulse" />
          ))}
        </ul>
      ) : visible.length === 0 ? (
        <p className="text-xs text-muted-foreground">All clear — no open finance issues detected.</p>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <section key={g.severity} aria-label={`${g.label} items`}>
              <div className="flex items-center gap-2 mb-1.5">
                {severityIcon(g.severity)}
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {g.label} <span className="text-muted-foreground/70">· {g.items.length}</span>
                </h3>
              </div>
              <ul className="space-y-2">
                {g.items.map((a) => (
                  <IntelRow
                    key={a.id}
                    item={a}
                    currency={currency}
                    busy={busyId === a.id}
                    onResolve={() => onResolve(a.id)}
                    onDismiss={() => onDismiss(a.id)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function severityIcon(sev: string) {
  if (sev === "CRITICAL") return <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />;
  if (sev === "WARNING") return <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />;
  return <Info className="w-4 h-4 text-sky-500 shrink-0 mt-0.5" />;
}

/**
 * Per-detector primary call-to-action label. The destination URL is
 * pre-baked by the backend in `recommendedAction` and already includes
 * an `?action=` param the target page can use to open the right
 * resolver UI (send reminder / categorise / upload receipt / open
 * reconciliation).
 */
function primaryLabel(kind: string): string {
  switch (kind) {
    case "SLOW_PAYER": return "Send reminder";
    case "MISSING_RECEIPT": return "Upload receipt";
    case "UNCATEGORISED": return "Categorise";
    case "DUPLICATE_EXPENSE": return "Reconcile";
    case "TAX_RESERVE_GAP": return "Move to reserve";
    case "OVERSPENDING": return "Review category";
    case "MARGIN_DECLINE": return "Open report";
    case "CASHFLOW_RISK": return "Open cash flow";
    default: return "Open";
  }
}

function IntelRow({
  item, currency, busy, onResolve, onDismiss,
}: {
  item: FinanceIntelActionItem;
  currency: string;
  busy: boolean;
  onResolve: () => void;
  onDismiss: () => void;
}) {
  return (
    <li className="rounded-lg border border-border/30 bg-background/40 p-2.5">
      <div className="flex items-start gap-2">
        {severityIcon(item.severity)}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium truncate">{item.title}</p>
            <span className="text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 bg-muted/60 text-muted-foreground">
              {item.kind.replace(/_/g, " ")}
            </span>
            {item.amount != null && (
              <span className="text-xs font-semibold tabular-nums whitespace-nowrap">
                {formatCurrency(item.amount, currency)}
              </span>
            )}
          </div>
          {item.body && <p className="text-xs text-muted-foreground mt-0.5">{item.body}</p>}
          <div className="flex items-center gap-3 mt-1.5">
            {item.recommendedAction && (
              <Link
                href={item.recommendedAction}
                className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-0.5"
              >
                {primaryLabel(item.kind)} <ArrowRight className="w-3 h-3" />
              </Link>
            )}
            <button
              onClick={onResolve}
              disabled={busy}
              className="text-xs text-emerald-600 hover:underline inline-flex items-center gap-0.5 disabled:opacity-50"
              aria-label="Mark resolved"
            >
              <Check className="w-3 h-3" /> Resolve
            </button>
            <button
              onClick={onDismiss}
              disabled={busy}
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 disabled:opacity-50"
              aria-label="Dismiss"
            >
              <X className="w-3 h-3" /> Dismiss
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}
