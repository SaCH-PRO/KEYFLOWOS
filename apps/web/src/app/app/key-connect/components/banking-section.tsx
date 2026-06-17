"use client";

import { useEffect, useState, useCallback } from "react";
import { Cable, Plus, Loader2, Trash2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@keyflow/ui";
import {
  fetchBankConnections,
  createBankConnection,
  deleteBankConnection,
  syncBankConnection,
  type BankConnection,
} from "@/lib/api/finance";

interface BankingSectionProps {
  businessId: string;
}

const PROVIDERS = [
  { value: "plaid", label: "Plaid" },
  { value: "yodlee", label: "Yodlee" },
  { value: "salt_edge", label: "Salt Edge" },
  { value: "open_banking", label: "Open Banking" },
];

export function BankingSection({ businessId }: BankingSectionProps) {
  const [connections, setConnections] = useState<BankConnection[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<Record<string, Record<string, boolean>>>({});
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);

  const [financialAccountId, setFinancialAccountId] = useState("");
  const [provider, setProvider] = useState("plaid");
  const [providerItemId, setProviderItemId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetchBankConnections(businessId);
    if (res.data) setConnections(res.data.items ?? []);
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async hydration of bank connection list on mount
    load();
  }, [load]);

  const setBusyFor = (id: string, action: string, value: boolean) => {
    setBusy((prev) => ({ ...prev, [id]: { ...prev[id], [action]: value } }));
  };

  const handleCreate = async () => {
    if (!financialAccountId.trim() || !provider) return;
    setSaving(true);
    const res = await createBankConnection(businessId, {
      financialAccountId: financialAccountId.trim(),
      provider,
      providerItemId: providerItemId.trim() || undefined,
    });
    setSaving(false);
    if (res.data) {
      setConnections((prev) => [...prev, res.data!]);
      setShowAdd(false);
      setFinancialAccountId("");
      setProviderItemId("");
      toast.success("Bank connection created");
    } else {
      toast.error(res.error || "Failed to create connection");
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this bank connection? This cannot be undone.")) return;
    setBusyFor(id, "delete", true);
    const res = await deleteBankConnection(businessId, id);
    setBusyFor(id, "delete", false);
    if (res.error) {
      toast.error(res.error);
    } else {
      setConnections((prev) => prev.filter((c) => c.id !== id));
      toast.success("Bank connection deleted");
    }
  };

  const handleSync = async (id: string) => {
    setBusyFor(id, "sync", true);
    const res = await syncBankConnection(businessId, id);
    setBusyFor(id, "sync", false);
    if (res.error) {
      toast.error(res.error);
    } else {
      toast.success("Bank sync started");
      await load();
    }
  };

  const connectedCount = connections.filter((c) => c.status === "ACTIVE").length;

  return (
    <section className="space-y-3" id="banking">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-[hsl(var(--kf-accent1))]/20 to-[hsl(var(--kf-accent2))]/20 border border-border/40 flex items-center justify-center text-[11px] font-bold">
            $
          </div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Banking</h3>
          <span className="text-[10px] text-muted-foreground/60">
            {connectedCount}/{connections.length || PROVIDERS.length} active
          </span>
        </div>
        <Button size="sm" variant="outline" onClick={() => setShowAdd(!showAdd)} className="h-7 text-xs">
          <Plus className="h-3 w-3 mr-1" />
          Add connection
        </Button>
      </div>

      {showAdd && (
        <div className="rounded-2xl border border-border/40 bg-card p-4 space-y-3">
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
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
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
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={saving || !financialAccountId.trim()}
            className="h-7 text-xs"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Plus className="h-3 w-3 mr-1" />}
            Create connection
          </Button>
        </div>
      )}

      <div className="space-y-2">
        {loading && connections.length === 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[1, 2].map((i) => (
              <div key={i} className="h-28 rounded-2xl bg-muted/10 border border-border/20 animate-pulse" />
            ))}
          </div>
        ) : connections.length === 0 ? (
          <div className="rounded-2xl border border-border/40 bg-card p-8 text-center text-sm text-muted-foreground">
            No bank connections yet. Link a bank account to import transactions.
          </div>
        ) : (
          connections.map((conn) => {
            const statusColor =
              conn.status === "ACTIVE"
                ? "text-emerald-400"
                : conn.status === "ERROR"
                ? "text-red-400"
                : "text-amber-400";
            return (
              <div
                key={conn.id}
                className="rounded-2xl border border-border/40 bg-card p-4 flex flex-col sm:flex-row sm:items-center gap-3"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="h-10 w-10 rounded-xl bg-muted/50 border border-border/30 flex items-center justify-center shrink-0">
                    <Cable className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-semibold truncate capitalize">{conn.provider.replace(/_/g, " ")}</h4>
                      <span className={`text-[10px] font-medium ${statusColor}`}>{conn.status}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground/70 truncate">Account {conn.financialAccountId}</p>
                    {conn.lastSyncAt && (
                      <p className="text-[10px] text-muted-foreground/50">
                        Last sync {new Date(conn.lastSyncAt).toLocaleString()}
                      </p>
                    )}
                    {conn.errorMessage && (
                      <p className="text-[11px] text-red-400 truncate">{conn.errorMessage}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleSync(conn.id)}
                    disabled={busy[conn.id]?.sync}
                    className="h-7 text-xs"
                  >
                    {busy[conn.id]?.sync ? (
                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    ) : (
                      <RefreshCw className="h-3 w-3 mr-1" />
                    )}
                    Sync
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDelete(conn.id)}
                    disabled={busy[conn.id]?.delete}
                    className="h-7 text-xs text-red-400 hover:text-red-300"
                  >
                    {busy[conn.id]?.delete ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Trash2 className="h-3 w-3" />
                    )}
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
