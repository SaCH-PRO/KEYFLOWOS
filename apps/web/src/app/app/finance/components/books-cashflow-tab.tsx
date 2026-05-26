"use client";

import { useCallback, useEffect, useState } from "react";
import { Banknote } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { getStoredBusinessId } from "@/lib/workspace";
import { formatCurrency } from "@/lib/currency";
import { fetchFinanceOverview, fetchRevenueOverview } from "@/lib/client";
import { SkeletonGrid } from "../_overview-client";

export function BooksCashflowTab() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setBusinessId(getStoredBusinessId()); }, []);
  if (!businessId) return <SkeletonGrid />;
  return <CashflowBody businessId={businessId} />;
}

function CashflowBody({ businessId }: { businessId: string }) {
  const [pulse, setPulse] = useState<{ weekStart: string; collected: number; billed: number; outstanding: number }[] | null>(null);
  const [currency, setCurrency] = useState("TTD");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [r, o] = await Promise.all([
        fetchRevenueOverview(businessId),
        fetchFinanceOverview(businessId),
      ]);
      if (r.error) setError(r.error);
      else if (r.data) setPulse(r.data.pulse);
      if (o.data) setCurrency(o.data.currency);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load cashflow");
    }
    setLoading(false);
  }, [businessId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  if (loading) return <SkeletonGrid />;
  if (error) {
    return (
      <div className="rounded-xl border border-border/40 bg-card/40 p-6">
        <div className="flex items-start gap-2 text-sm">
          <Banknote className="w-4 h-4 mt-0.5 text-amber-500" />
          <div>
            <p className="font-medium">Couldn&apos;t load cashflow</p>
            <p className="text-xs text-muted-foreground mt-1">{error}</p>
            <button onClick={load} className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (!pulse || pulse.length === 0) {
    return (
      <EmptyState
        icon={Banknote}
        title="No cashflow data yet"
        description="Once invoices and payments start flowing, this view will populate."
        variant="compact"
      />
    );
  }
  const max = Math.max(1, ...pulse.flatMap((w) => [w.collected, w.billed]));
  return (
    <div className="rounded-xl border border-border/40 bg-card/40 p-4">
      <h2 className="text-sm font-semibold mb-3">Cashflow — last 12 weeks</h2>
      <div className="flex items-end gap-1.5 h-40">
        {pulse.map((w) => (
          <div key={w.weekStart} className="flex-1 flex flex-col items-stretch gap-0.5 justify-end" title={`${w.weekStart}\nCollected ${formatCurrency(w.collected, currency)}\nBilled ${formatCurrency(w.billed, currency)}`}>
            <div className="rounded-t bg-emerald-500/70" style={{ height: `${(w.collected / max) * 100}%`, minHeight: w.collected > 0 ? 2 : 0 }} />
            <div className="rounded-t bg-blue-500/30" style={{ height: `${(w.billed / max) * 30}%`, minHeight: w.billed > 0 ? 2 : 0 }} />
          </div>
        ))}
      </div>
      <div className="flex gap-3 mt-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-emerald-500/70" /> Collected</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-blue-500/30" /> Billed</span>
      </div>
    </div>
  );
}
