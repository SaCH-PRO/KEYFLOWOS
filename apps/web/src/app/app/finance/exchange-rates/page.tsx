"use client";

import { useEffect, useState, useCallback } from "react";
import { Globe, Plus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { UnifiedPageShell } from "@/components/layout/unified-page-shell";
import { DataTable } from "@/components/ui/data-table";
import { getStoredBusinessId } from "@/lib/workspace";
import { fetchExchangeRates, createExchangeRate, deleteExchangeRate, type ExchangeRate } from "@/lib/api/finance";

export default function ExchangeRatesPage() {
  const businessId = getStoredBusinessId() ?? "";
  const [rates, setRates] = useState<ExchangeRate[]>([]);
  const [_loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);

  const [fromCurrency, setFromCurrency] = useState("USD");
  const [toCurrency, setToCurrency] = useState("TTD");
  const [rate, setRate] = useState("");
  const [date, setDate] = useState("");
  const [source, setSource] = useState("manual");

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchExchangeRates(businessId);
      if (res.data) setRates(res.data.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load exchange rates");
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async () => {
    if (!businessId || !fromCurrency || !toCurrency || !rate || !date) return;
    setSaving(true);
    try {
      const res = await createExchangeRate(businessId, {
        fromCurrency,
        toCurrency,
        rate: Number(rate),
        date,
        source,
      });
      if (res.data) {
        setRates((prev) => [res.data!, ...prev]);
        setShowAdd(false);
        setRate("");
        setDate("");
        toast.success("Exchange rate created");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create rate");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!businessId) return;
    if (!window.confirm("Are you sure? This cannot be undone.")) return;
    try {
      await deleteExchangeRate(businessId, id);
      setRates((prev) => prev.filter((r) => r.id !== id));
      toast.success("Exchange rate deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete rate");
    }
  };

  return (
    <UnifiedPageShell
      title="Exchange Rates"
      subtitle="Daily FX rates for multi-currency revaluation."
      icon={Globe}
      maxWidth="5xl"
      headerActions={
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity"
        >
          <Plus className="w-3 h-3" />
          Add Rate
        </button>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
            <button onClick={load} className="ml-2 underline">Retry</button>
          </div>
        )}
        {showAdd && (
          <div className="kf-card p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input
                type="text"
                value={fromCurrency}
                onChange={(e) => setFromCurrency(e.target.value.toUpperCase())}
                placeholder="From (e.g. USD)"
                aria-label="From currency"
                className="px-3 py-2 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              />
              <input
                type="text"
                value={toCurrency}
                onChange={(e) => setToCurrency(e.target.value.toUpperCase())}
                placeholder="To (e.g. TTD)"
                aria-label="To currency"
                className="px-3 py-2 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              />
              <input
                type="number"
                step="0.00000001"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                placeholder="Rate"
                aria-label="Exchange rate"
                className="px-3 py-2 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              />
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="px-3 py-2 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              />
              <input
                type="text"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="Source"
                aria-label="Source"
                className="px-3 py-2 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              />
            </div>
            <button
              onClick={handleCreate}
              disabled={saving || !fromCurrency || !toCurrency || !rate || !date}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              Create Rate
            </button>
          </div>
        )}

        <DataTable
          data={rates as unknown as Record<string, unknown>[]}
          keyField="id"
          pageSize={25}
          columns={[
            { key: "fromCurrency", header: "From", sortable: true, getValue: (r) => (r as unknown as ExchangeRate).fromCurrency },
            { key: "toCurrency", header: "To", sortable: true, getValue: (r) => (r as unknown as ExchangeRate).toCurrency },
            { key: "rate", header: "Rate", sortable: true, render: (r) => <span className="text-xs font-mono font-medium">{(r as unknown as ExchangeRate).rate.toFixed(8)}</span> },
            { key: "date", header: "Date", sortable: true, render: (r) => <span className="text-xs">{new Date((r as unknown as ExchangeRate).date).toLocaleDateString()}</span> },
            { key: "source", header: "Source", getValue: (r) => (r as unknown as ExchangeRate).source ?? "manual" },
            { key: "actions", header: "", render: (r) => (
              <button onClick={() => handleDelete((r as unknown as ExchangeRate).id)} className="p-1 rounded hover:bg-red-500/10 transition-colors">
                <Trash2 className="w-3.5 h-3.5 text-red-500" />
              </button>
            )},
          ]}
          emptyMessage="No exchange rates yet."
        />
      </div>
    </UnifiedPageShell>
  );
}
