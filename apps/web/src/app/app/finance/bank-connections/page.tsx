"use client";

import { useEffect, useState, useCallback } from "react";
import { Cable, Plus, Loader2, Trash2, Power } from "lucide-react";
import { toast } from "sonner";
import { UnifiedPageShell } from "@/components/layout/unified-page-shell";
import { DataTable } from "@/components/ui/data-table";
import { getStoredBusinessId } from "@/lib/workspace";
import { fetchBankConnections, createBankConnection, deleteBankConnection, type BankConnection } from "@/lib/api/finance";

export default function BankConnectionsPage() {
  const businessId = getStoredBusinessId() ?? "";
  const [connections, setConnections] = useState<BankConnection[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);

  const [financialAccountId, setFinancialAccountId] = useState("");
  const [provider, setProvider] = useState("plaid");
  const [providerItemId, setProviderItemId] = useState("");

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchBankConnections(businessId);
      if (res.data) setConnections(res.data.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load bank connections");
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async () => {
    if (!businessId || !financialAccountId.trim() || !provider) return;
    setSaving(true);
    try {
      const res = await createBankConnection(businessId, {
        financialAccountId: financialAccountId.trim(),
        provider,
        providerItemId: providerItemId.trim() || undefined,
      });
      if (res.data) {
        setConnections((prev) => [...prev, res.data!]);
        setShowAdd(false);
        setFinancialAccountId("");
        setProviderItemId("");
        toast.success("Bank connection created");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create connection");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!businessId) return;
    if (!window.confirm("Are you sure? This cannot be undone.")) return;
    try {
      await deleteBankConnection(businessId, id);
      setConnections((prev) => prev.filter((c) => c.id !== id));
      toast.success("Bank connection deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete connection");
    }
  };

  return (
    <UnifiedPageShell
      title="Bank Connections"
      subtitle="Link bank accounts for automated transaction import."
      icon={Cable}
      maxWidth="5xl"
      headerActions={
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity"
        >
          <Plus className="w-3 h-3" />
          Add Connection
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
                value={financialAccountId}
                onChange={(e) => setFinancialAccountId(e.target.value)}
                placeholder="Financial Account ID"
                aria-label="Financial account ID"
                className="px-3 py-2 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              />
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="px-3 py-2 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              >
                <option value="plaid">Plaid</option>
                <option value="yodlee">Yodlee</option>
                <option value="salt_edge">Salt Edge</option>
                <option value="open_banking">Open Banking</option>
              </select>
              <input
                type="text"
                value={providerItemId}
                onChange={(e) => setProviderItemId(e.target.value)}
                placeholder="Provider Item ID (optional)"
                aria-label="Provider item ID"
                className="px-3 py-2 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              />
            </div>
            <button
              onClick={handleCreate}
              disabled={saving || !financialAccountId.trim()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              Create Connection
            </button>
          </div>
        )}

        <DataTable
          data={connections as unknown as Record<string, unknown>[]}
          keyField="id"
          pageSize={25}
          columns={[
            { key: "provider", header: "Provider", sortable: true, getValue: (r) => (r as unknown as BankConnection).provider },
            { key: "financialAccountId", header: "Account ID", getValue: (r) => (r as unknown as BankConnection).financialAccountId },
            { key: "status", header: "Status", sortable: true, render: (r) => {
              const s = (r as unknown as BankConnection).status;
              const color = s === 'ACTIVE' ? 'text-emerald-600' : s === 'ERROR' ? 'text-red-500' : 'text-amber-500';
              return <span className={`text-xs font-medium ${color}`}>{s}</span>;
            }},
            { key: "lastSyncAt", header: "Last Sync", render: (r) => {
              const d = (r as unknown as BankConnection).lastSyncAt;
              return <span className="text-xs text-muted-foreground">{d ? new Date(d).toLocaleDateString() : "Never"}</span>;
            }},
            { key: "errorMessage", header: "Error", getValue: (r) => (r as unknown as BankConnection).errorMessage ?? "—" },
            { key: "actions", header: "", render: (r) => (
              <button onClick={() => handleDelete((r as unknown as BankConnection).id)} className="p-1 rounded hover:bg-red-500/10 transition-colors">
                <Trash2 className="w-3.5 h-3.5 text-red-500" />
              </button>
            )},
          ]}
          emptyMessage="No bank connections yet. Link a bank account to import transactions."
        />
      </div>
    </UnifiedPageShell>
  );
}
