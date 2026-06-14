"use client";

import { useEffect, useState, useCallback } from "react";
import { Package, Plus, Loader2, Trash2, TrendingDown, XCircle } from "lucide-react";
import { toast } from "sonner";
import { UnifiedPageShell } from "@/components/layout/unified-page-shell";
import { DataTable } from "@/components/ui/data-table";
import { getStoredBusinessId } from "@/lib/workspace";
import { fetchFixedAssets, createFixedAsset, depreciateFixedAsset, deleteFixedAsset, type FixedAsset } from "@/lib/api/finance";

export default function FixedAssetsPage() {
  const businessId = getStoredBusinessId() ?? "";
  const [assets, setAssets] = useState<FixedAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [category, setCategory] = useState("equipment");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [purchaseCost, setPurchaseCost] = useState("");
  const [salvageValue, setSalvageValue] = useState("");
  const [usefulLifeMonths, setUsefulLifeMonths] = useState("60");
  const [depreciationMethod, setDepreciationMethod] = useState("straight_line");

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchFixedAssets(businessId);
      if (res.data) setAssets(res.data.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load fixed assets");
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async () => {
    if (!businessId || !name.trim() || !purchaseDate || !purchaseCost || !usefulLifeMonths) return;
    setSaving(true);
    try {
      const res = await createFixedAsset(businessId, {
        name: name.trim(),
        category,
        purchaseDate,
        purchaseCost: Number(purchaseCost),
        salvageValue: salvageValue ? Number(salvageValue) : undefined,
        usefulLifeMonths: Number(usefulLifeMonths),
        depreciationMethod,
      });
      if (res.data) {
        setAssets((prev) => [...prev, res.data!]);
        setShowAdd(false);
        setName("");
        setPurchaseDate("");
        setPurchaseCost("");
        setSalvageValue("");
        setUsefulLifeMonths("60");
        toast.success("Fixed asset created");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create asset");
    } finally {
      setSaving(false);
    }
  };

  const handleDepreciate = async (id: string) => {
    if (!businessId) return;
    try {
      const res = await depreciateFixedAsset(businessId, id);
      if (res.data) {
        load();
        toast.success("Depreciation run completed");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to run depreciation");
    }
  };

  const handleDelete = async (id: string) => {
    if (!businessId) return;
    if (!window.confirm("Are you sure? This cannot be undone.")) return;
    try {
      await deleteFixedAsset(businessId, id);
      setAssets((prev) => prev.filter((a) => a.id !== id));
      toast.success("Fixed asset deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete asset");
    }
  };

  return (
    <UnifiedPageShell
      title="Fixed Assets"
      subtitle="Asset register with depreciation tracking."
      icon={Package}
      maxWidth="5xl"
      headerActions={
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity"
        >
          <Plus className="w-3 h-3" />
          Add Asset
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Asset name"
                aria-label="Asset name"
                className="px-3 py-2 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              />
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="px-3 py-2 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              >
                <option value="equipment">Equipment</option>
                <option value="vehicle">Vehicle</option>
                <option value="property">Property</option>
                <option value="furniture">Furniture</option>
                <option value="technology">Technology</option>
              </select>
              <input
                type="date"
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
                className="px-3 py-2 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              />
              <input
                type="number"
                value={purchaseCost}
                onChange={(e) => setPurchaseCost(e.target.value)}
                placeholder="Purchase cost"
                aria-label="Purchase cost"
                className="px-3 py-2 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              />
              <input
                type="number"
                value={salvageValue}
                onChange={(e) => setSalvageValue(e.target.value)}
                placeholder="Salvage value"
                aria-label="Salvage value"
                className="px-3 py-2 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              />
              <input
                type="number"
                value={usefulLifeMonths}
                onChange={(e) => setUsefulLifeMonths(e.target.value)}
                placeholder="Useful life (months)"
                aria-label="Useful life in months"
                className="px-3 py-2 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              />
              <select
                value={depreciationMethod}
                onChange={(e) => setDepreciationMethod(e.target.value)}
                className="px-3 py-2 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              >
                <option value="straight_line">Straight Line</option>
                <option value="reducing_balance">Reducing Balance</option>
              </select>
            </div>
            <button
              onClick={handleCreate}
              disabled={saving || !name.trim() || !purchaseDate || !purchaseCost}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              Create Asset
            </button>
          </div>
        )}

        <DataTable
          data={assets as unknown as Record<string, unknown>[]}
          keyField="id"
          pageSize={25}
          columns={[
            { key: "name", header: "Name", sortable: true, getValue: (r) => (r as unknown as FixedAsset).name },
            { key: "category", header: "Category", sortable: true, getValue: (r) => (r as unknown as FixedAsset).category },
            { key: "purchaseCost", header: "Cost", sortable: true, render: (r) => <span className="text-xs font-medium">{(r as unknown as FixedAsset).purchaseCost.toLocaleString()}</span> },
            { key: "netBookValue", header: "NBV", sortable: true, render: (r) => <span className="text-xs font-medium">{(r as unknown as FixedAsset).netBookValue.toLocaleString()}</span> },
            { key: "accumulatedDepreciation", header: "Accum. Dep.", sortable: true, render: (r) => <span className="text-xs text-muted-foreground">{(r as unknown as FixedAsset).accumulatedDepreciation.toLocaleString()}</span> },
            { key: "status", header: "Status", sortable: true, render: (r) => {
              const s = (r as unknown as FixedAsset).status;
              const color = s === 'ACTIVE' ? 'text-emerald-600' : s === 'DISPOSED' ? 'text-red-500' : 'text-amber-500';
              return <span className={`text-xs font-medium ${color}`}>{s}</span>;
            }},
            { key: "actions", header: "", render: (r) => {
              const asset = r as unknown as FixedAsset;
              return (
                <div className="flex items-center gap-1">
                  {asset.status === 'ACTIVE' && (
                    <button onClick={() => handleDepreciate(asset.id)} className="p-1 rounded hover:bg-muted transition-colors" title="Run depreciation">
                      <TrendingDown className="w-3.5 h-3.5 text-amber-500" />
                    </button>
                  )}
                  <button onClick={() => handleDelete(asset.id)} className="p-1 rounded hover:bg-red-500/10 transition-colors">
                    <Trash2 className="w-3.5 h-3.5 text-red-500" />
                  </button>
                </div>
              );
            }},
          ]}
          emptyMessage="No fixed assets yet."
        />
      </div>
    </UnifiedPageShell>
  );
}
