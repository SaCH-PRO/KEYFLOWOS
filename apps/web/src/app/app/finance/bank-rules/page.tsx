"use client";

import { useEffect, useState, useCallback } from "react";
import { ListFilter, Plus, Loader2, Trash2, Play, Power } from "lucide-react";
import { UnifiedPageShell } from "@/components/layout/unified-page-shell";
import { DataTable } from "@/components/ui/data-table";
import { getStoredBusinessId } from "@/lib/workspace";
import { fetchBankRules, createBankRule, updateBankRule, deleteBankRule, applyBankRules, type BankRule } from "@/lib/api/finance";

export default function BankRulesPage() {
  const businessId = getStoredBusinessId() ?? "";
  const [rules, setRules] = useState<BankRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);

  const [name, setName] = useState("");
  const [pattern, setPattern] = useState("");
  const [matchType, setMatchType] = useState("contains");
  const [accountId, setAccountId] = useState("");
  const [expenseCategoryId, setExpenseCategoryId] = useState("");
  const [priority, setPriority] = useState("0");

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const res = await fetchBankRules(businessId);
      if (res.data) setRules(res.data);
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async () => {
    if (!businessId || !name.trim() || !pattern.trim() || !accountId.trim()) return;
    setSaving(true);
    try {
      const res = await createBankRule(businessId, {
        name: name.trim(),
        pattern: pattern.trim(),
        matchType,
        accountId,
        expenseCategoryId: expenseCategoryId || null,
        priority: Number(priority) || 0,
      });
      if (res.data) {
        setRules((prev) => [...prev, res.data!]);
        setShowAdd(false);
        setName("");
        setPattern("");
        setAccountId("");
        setExpenseCategoryId("");
        setPriority("0");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (rule: BankRule) => {
    if (!businessId) return;
    const res = await updateBankRule(businessId, rule.id, { isActive: !rule.isActive });
    if (res.data) {
      setRules((prev) => prev.map((r) => (r.id === rule.id ? res.data! : r)));
    }
  };

  const handleDelete = async (id: string) => {
    if (!businessId) return;
    await deleteBankRule(businessId, id);
    setRules((prev) => prev.filter((r) => r.id !== id));
  };

  const handleApply = async () => {
    if (!businessId) return;
    setApplying(true);
    try {
      await applyBankRules(businessId);
      alert("Bank rules applied successfully");
    } finally {
      setApplying(false);
    }
  };

  return (
    <UnifiedPageShell
      title="Bank Rules"
      subtitle="Auto-categorize imported bank transactions by pattern."
      icon={ListFilter}
      maxWidth="5xl"
      headerActions={
        <div className="flex items-center gap-2">
          <button
            onClick={handleApply}
            disabled={applying}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-600 text-white hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {applying ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
            Run Rules
          </button>
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity"
          >
            <Plus className="w-3 h-3" />
            Add Rule
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {showAdd && (
          <div className="kf-card p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Rule name"
                className="px-3 py-2 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              />
              <input
                type="text"
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                placeholder="Pattern (e.g. 'AMAZON')"
                className="px-3 py-2 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              />
              <select
                value={matchType}
                onChange={(e) => setMatchType(e.target.value)}
                className="px-3 py-2 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              >
                <option value="contains">Contains</option>
                <option value="startsWith">Starts With</option>
                <option value="equals">Equals</option>
                <option value="regex">Regex</option>
              </select>
              <input
                type="text"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                placeholder="Chart of Account ID"
                className="px-3 py-2 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              />
              <input
                type="text"
                value={expenseCategoryId}
                onChange={(e) => setExpenseCategoryId(e.target.value)}
                placeholder="Expense Category ID (optional)"
                className="px-3 py-2 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              />
              <input
                type="number"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                placeholder="Priority"
                className="px-3 py-2 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              />
            </div>
            <button
              onClick={handleCreate}
              disabled={saving || !name.trim() || !pattern.trim() || !accountId.trim()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              Create Rule
            </button>
          </div>
        )}

        <DataTable
          data={rules as unknown as Record<string, unknown>[]}
          keyField="id"
          pageSize={25}
          columns={[
            { key: "name", header: "Name", sortable: true, getValue: (r) => (r as unknown as BankRule).name },
            { key: "pattern", header: "Pattern", sortable: true, getValue: (r) => (r as unknown as BankRule).pattern },
            { key: "matchType", header: "Match", sortable: true, getValue: (r) => (r as unknown as BankRule).matchType },
            { key: "priority", header: "Priority", sortable: true, getValue: (r) => String((r as unknown as BankRule).priority) },
            { key: "accountId", header: "Account", getValue: (r) => (r as unknown as BankRule).accountId },
            { key: "isActive", header: "Active", render: (r) => {
              const active = (r as unknown as BankRule).isActive;
              return (
                <span className={`inline-flex items-center gap-1 text-xs font-medium ${active ? "text-emerald-600" : "text-muted-foreground"}`}>
                  <Power className="w-3 h-3" />
                  {active ? "Yes" : "No"}
                </span>
              );
            }},
            { key: "actions", header: "", render: (r) => {
              const rule = r as unknown as BankRule;
              return (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleToggle(rule)}
                    className="p-1 rounded hover:bg-muted transition-colors"
                    title={rule.isActive ? "Deactivate" : "Activate"}
                  >
                    <Power className={`w-3.5 h-3.5 ${rule.isActive ? "text-emerald-500" : "text-muted-foreground"}`} />
                  </button>
                  <button
                    onClick={() => handleDelete(rule.id)}
                    className="p-1 rounded hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-red-500" />
                  </button>
                </div>
              );
            }},
          ]}
          emptyMessage="No bank rules yet. Add one to auto-categorize transactions."
        />
      </div>
    </UnifiedPageShell>
  );
}
