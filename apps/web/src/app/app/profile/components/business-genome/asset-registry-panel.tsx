"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Briefcase,
  Plus,
  Trash2,
  Loader2,
  AlertCircle,
  Globe,
  CreditCard,
  FileText,
  Hammer,
  BadgeCheck,
  Share2,
  Monitor,
  ShoppingBag,
} from "lucide-react";
import { toast } from "sonner";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  getBusinessAssets,
  getBusinessAssetSummary,
  createBusinessAsset,
  deleteBusinessAsset,
  type BusinessAsset,
  type BusinessAssetType,
} from "@/lib/api/business-assets";

const ASSET_TYPES: { value: BusinessAssetType; label: string; icon: React.ElementType }[] = [
  { value: "DOMAIN", label: "Domain", icon: Globe },
  { value: "WEBSITE", label: "Website", icon: Monitor },
  { value: "SOCIAL", label: "Social account", icon: Share2 },
  { value: "BANK", label: "Bank account", icon: CreditCard },
  { value: "PAYMENT_PROCESSOR", label: "Payment processor", icon: ShoppingBag },
  { value: "LICENSE", label: "License", icon: BadgeCheck },
  { value: "EQUIPMENT", label: "Equipment", icon: Hammer },
  { value: "CONTRACT", label: "Contract", icon: FileText },
  { value: "BRAND_ASSET", label: "Brand asset", icon: Briefcase },
  { value: "SOFTWARE", label: "Software", icon: Monitor },
];

const TYPE_COLORS: Record<BusinessAssetType, string> = {
  DOMAIN: "hsl(var(--kf-accent1))",
  WEBSITE: "hsl(var(--kf-accent2))",
  SOCIAL: "hsl(320 80% 60%)",
  BANK: "hsl(145 70% 45%)",
  PAYMENT_PROCESSOR: "hsl(35 90% 55%)",
  LICENSE: "hsl(260 70% 60%)",
  EQUIPMENT: "hsl(0 80% 60%)",
  CONTRACT: "hsl(210 80% 60%)",
  BRAND_ASSET: "hsl(170 80% 40%)",
  SOFTWARE: "hsl(190 90% 55%)",
};

function typeIcon(type: BusinessAssetType) {
  const t = ASSET_TYPES.find((x) => x.value === type);
  return t?.icon || Briefcase;
}

export function AssetRegistryPanel() {
  const businessId = getStoredBusinessId();
  const [assets, setAssets] = useState<BusinessAsset[]>([]);
  const [summary, setSummary] = useState<{ total: number; byType: Record<string, number>; risks: string[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<{
    type: BusinessAssetType;
    name: string;
    provider: string;
    url: string;
    identifier: string;
    owner: string;
    expiresAt: string;
  }>({
    type: "DOMAIN",
    name: "",
    provider: "",
    url: "",
    identifier: "",
    owner: "",
    expiresAt: "",
  });

  const load = useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const [{ data: assetsData }, { data: summaryData }] = await Promise.all([
      getBusinessAssets(businessId),
      getBusinessAssetSummary(businessId),
    ]);
    if (assetsData) setAssets(assetsData);
    if (summaryData) setSummary(summaryData);
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial async load of asset registry
    void load();
  }, [load]);

  const handleCreate = async () => {
    if (!businessId || !form.name.trim()) return;
    setSaving(true);
    const { data, error } = await createBusinessAsset(businessId, {
      type: form.type,
      name: form.name.trim(),
      provider: form.provider.trim() || undefined,
      url: form.url.trim() || undefined,
      identifier: form.identifier.trim() || undefined,
      owner: form.owner.trim() || undefined,
      expiresAt: form.expiresAt || undefined,
    });
    setSaving(false);

    if (error || !data) {
      toast.error(error || "Failed to add asset");
      return;
    }

    toast.success(`${data.name} added to registry`);
    setForm({ type: "DOMAIN", name: "", provider: "", url: "", identifier: "", owner: "", expiresAt: "" });
    setShowForm(false);
    void load();
  };

  const handleDelete = async (asset: BusinessAsset) => {
    if (!businessId) return;
    const confirmed = window.confirm(`Remove ${asset.name} from the registry?`);
    if (!confirmed) return;

    const { error } = await deleteBusinessAsset(businessId, asset.id);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success(`${asset.name} removed`);
    void load();
  };

  const grouped = assets.reduce<Record<string, BusinessAsset[]>>((acc, asset) => {
    acc[asset.type] = acc[asset.type] || [];
    acc[asset.type].push(asset);
    return acc;
  }, {});

  if (loading) {
    return (
      <div className="kf-card p-12 flex flex-col items-center justify-center gap-3 min-h-[400px]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading Asset Registry...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div
        className="rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
        style={{
          background: "linear-gradient(135deg, hsl(var(--kf-card)) 0%, hsl(var(--kf-muted) / 0.1) 100%)",
          border: "1px solid hsl(var(--kf-border) / 0.2)",
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: "hsl(var(--kf-accent1) / 0.1)" }}
          >
            <Briefcase className="w-5 h-5" style={{ color: "hsl(var(--kf-accent1))" }} />
          </div>
          <div>
            <h2 className="text-base font-semibold">Asset Registry</h2>
            <p className="text-xs text-muted-foreground">
              What the business owns, uses, controls, and depends on.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowForm((s) => !s)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors"
            style={{ background: "hsl(var(--kf-accent1))", color: "#fff" }}
          >
            <Plus className="w-3.5 h-3.5" />
            Add asset
          </button>
        </div>
      </div>

      {/* Summary */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <div className="kf-card p-3 text-center">
            <div className="text-xs text-muted-foreground">Total assets</div>
            <div className="text-xl font-bold">{summary.total}</div>
          </div>
          {Object.entries(summary.byType).map(([type, count]) => {
            const Icon = typeIcon(type as BusinessAssetType);
            return (
              <div key={type} className="kf-card p-3 text-center">
                <div className="flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wider">
                  <Icon className="w-3 h-3" style={{ color: TYPE_COLORS[type as BusinessAssetType] }} />
                  {type.replace(/_/g, " ")}
                </div>
                <div className="text-xl font-bold">{count}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Risk alerts */}
      {summary && summary.risks.length > 0 && (
        <div
          className="rounded-lg p-3 flex items-start gap-2 text-sm"
          style={{
            background: "hsl(var(--kf-warning) / 0.08)",
            border: "1px solid hsl(var(--kf-warning) / 0.2)",
            color: "hsl(var(--kf-warning))",
          }}
        >
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <span className="font-medium">Upcoming expirations</span>
            <ul className="text-xs opacity-90 list-disc list-inside">
              {summary.risks.map((risk) => (
                <li key={risk}>{risk}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Create form */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="kf-card p-4 space-y-3"
          >
            <h3 className="text-sm font-semibold">Add a business asset</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Type</label>
                <select
                  value={form.type}
                  onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as BusinessAssetType }))}
                  className="w-full rounded-lg border border-[hsl(var(--kf-border)/0.3)] bg-background px-3 py-2 text-sm"
                >
                  {ASSET_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. keyflowos.com"
                  className="w-full rounded-lg border border-[hsl(var(--kf-border)/0.3)] bg-background px-3 py-2 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Provider</label>
                <input
                  type="text"
                  value={form.provider}
                  onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))}
                  placeholder="e.g. GoDaddy"
                  className="w-full rounded-lg border border-[hsl(var(--kf-border)/0.3)] bg-background px-3 py-2 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">URL</label>
                <input
                  type="text"
                  value={form.url}
                  onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                  placeholder="https://..."
                  className="w-full rounded-lg border border-[hsl(var(--kf-border)/0.3)] bg-background px-3 py-2 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Identifier</label>
                <input
                  type="text"
                  value={form.identifier}
                  onChange={(e) => setForm((f) => ({ ...f, identifier: e.target.value }))}
                  placeholder="Account number, serial, etc."
                  className="w-full rounded-lg border border-[hsl(var(--kf-border)/0.3)] bg-background px-3 py-2 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Owner</label>
                <input
                  type="text"
                  value={form.owner}
                  onChange={(e) => setForm((f) => ({ ...f, owner: e.target.value }))}
                  placeholder="Who manages this?"
                  className="w-full rounded-lg border border-[hsl(var(--kf-border)/0.3)] bg-background px-3 py-2 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Expires at</label>
                <input
                  type="date"
                  value={form.expiresAt}
                  onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))}
                  className="w-full rounded-lg border border-[hsl(var(--kf-border)/0.3)] bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => void handleCreate()}
                disabled={saving || !form.name.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-60"
                style={{ background: "hsl(var(--kf-accent1))", color: "#fff" }}
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                Add asset
              </button>
              <button
                onClick={() => setShowForm(false)}
                disabled={saving}
                className="px-4 py-2 rounded-lg text-xs font-medium border border-[hsl(var(--kf-border)/0.3)] hover:bg-muted transition-colors"
              >
                Cancel
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Asset list */}
      {assets.length === 0 ? (
        <div className="kf-card p-12 text-center">
          <Briefcase className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
          <h3 className="text-lg font-semibold">No assets yet</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
            Add domains, bank accounts, software, licenses, and anything else KEY should know about.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([type, items]) => {
            const Icon = typeIcon(type as BusinessAssetType);
            return (
              <div key={type} className="kf-card p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Icon className="w-4 h-4" style={{ color: TYPE_COLORS[type as BusinessAssetType] }} />
                  <h3 className="text-sm font-semibold">{type.replace(/_/g, " ")}</h3>
                  <span className="text-xs text-muted-foreground">({items.length})</span>
                </div>
                <div className="grid gap-2">
                  {items.map((asset) => (
                    <div
                      key={asset.id}
                      className="rounded-xl p-3 flex items-start justify-between gap-3"
                      style={{ background: "hsl(var(--kf-muted) / 0.06)" }}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">{asset.name}</span>
                          {asset.url && (
                            <a
                              href={asset.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[10px] text-muted-foreground hover:text-foreground truncate max-w-[120px]"
                            >
                              {asset.url}
                            </a>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground mt-1">
                          {asset.provider && <span>Provider: {asset.provider}</span>}
                          {asset.identifier && <span>ID: {asset.identifier}</span>}
                          {asset.owner && <span>Owner: {asset.owner}</span>}
                          {asset.expiresAt && (
                            <span>
                              Expires: {new Date(asset.expiresAt).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => void handleDelete(asset)}
                        className="p-2 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                        aria-label={`Remove ${asset.name}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
