"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Key,
  Plus,
  Copy,
  Eye,
  EyeOff,
  Trash2,
  Loader2,
  Shield,
  Globe,
  Code2,
  BookOpen,
  Webhook,
  CheckCircle2,
} from "lucide-react";
import Link from "next/link";
import { getStoredBusinessId } from "@/lib/workspace";
import { apiGet, apiPost, apiDelete } from "@/lib/api";
import { toast } from "sonner";
import { InfoBadge } from "@/components/ui/info-badge";

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsed: string | null;
  scopes: string[];
}

const AVAILABLE_SCOPES = [
  { value: "contacts:read", label: "Read Contacts" },
  { value: "contacts:write", label: "Write Contacts" },
  { value: "invoices:read", label: "Read Invoices" },
  { value: "invoices:write", label: "Write Invoices" },
  { value: "bookings:read", label: "Read Bookings" },
  { value: "bookings:write", label: "Write Bookings" },
  { value: "products:read", label: "Read Products" },
  { value: "products:write", label: "Write Products" },
  { value: "campaigns:read", label: "Read Campaigns" },
  { value: "expenses:read", label: "Read Expenses" },
  { value: "reports:read", label: "Read Reports" },
];

export default function DevelopersSettingsPage() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [form, setForm] = useState({ name: "", scopes: new Set<string>() });
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    const bid = getStoredBusinessId();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs external or derived state into local component state
    if (bid) setBusinessId(bid);
  }, []);

  const loadKeys = useCallback(async () => {
    if (!businessId) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await apiGet<{ keys: ApiKey[] }>(`/api/businesses/${businessId}/api-keys`);
      if (res.data?.keys) setApiKeys(res.data.keys);
    } catch {}
    setLoading(false);
  }, [businessId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs external or derived state into local component state
  useEffect(() => { loadKeys(); }, [loadKeys]);

  const handleCreate = async () => {
    if (!businessId || !form.name.trim()) return;
    setCreating(true);
    try {
      const res = await apiPost<{ key: string; apiKey: ApiKey }>({
        path: `/api/businesses/${businessId}/api-keys`,
        body: { name: form.name, scopes: Array.from(form.scopes) },
      });
      if (res.data) {
        setNewKey(res.data.key);
        setApiKeys((prev) => [res.data!.apiKey, ...prev]);
        setForm({ name: "", scopes: new Set() });
        toast.success("API key created");
      }
    } catch {
      toast.error("Failed to create API key");
    }
    setCreating(false);
  };

  const handleDelete = async (id: string) => {
    if (!businessId) return;
    setDeleting(id);
    try {
      await apiDelete(`/api/businesses/${businessId}/api-keys/${id}`);
      setApiKeys((prev) => prev.filter((k) => k.id !== id));
      toast.success("API key revoked");
    } catch {
      toast.error("Failed to revoke key");
    }
    setDeleting(null);
  };

  const toggleScope = (scope: string) => {
    setForm((f) => {
      const s = new Set(f.scopes);
      if (s.has(scope)) s.delete(scope);
      else s.add(scope);
      return { ...f, scopes: s };
    });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

  if (loading) {
    return (
      <div className="space-y-6 max-w-3xl animate-pulse">
        <div className="space-y-2">
          <div className="h-5 w-40 bg-muted/40 rounded-lg" />
          <div className="h-3 w-64 bg-muted/30 rounded-lg" />
        </div>
        <div className="kf-card p-6 space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 bg-muted/20 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Code2 className="w-5 h-5" style={{ color: "hsl(var(--kf-accent1))" }} />
          Developer Settings
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Manage API keys, webhooks, and integrations for your business.
        </p>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <Link
          href="/app/settings/webhooks"
          className="kf-card p-4 flex items-center gap-3 transition-all hover:border-[hsl(var(--kf-accent1)_/_0.4)]"
        >
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "hsl(var(--kf-accent2) / 0.1)" }}>
            <Webhook className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />
          </div>
          <div>
            <span className="text-sm font-medium">Webhooks</span>
            <p className="text-[10px] text-muted-foreground">Event notifications</p>
          </div>
        </Link>
        <div className="kf-card p-4 flex items-center gap-3 opacity-60">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "hsl(var(--kf-info) / 0.1)" }}>
            <BookOpen className="w-4 h-4" style={{ color: "hsl(var(--kf-info))" }} />
          </div>
          <div>
            <span className="text-sm font-medium">API Docs</span>
            <p className="text-[10px] text-muted-foreground">Coming soon</p>
          </div>
        </div>
        <div className="kf-card p-4 flex items-center gap-3 opacity-60">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "hsl(var(--kf-success) / 0.1)" }}>
            <Globe className="w-4 h-4" style={{ color: "hsl(var(--kf-success))" }} />
          </div>
          <div>
            <span className="text-sm font-medium">App Store</span>
            <p className="text-[10px] text-muted-foreground">Coming soon</p>
          </div>
        </div>
      </div>

      <div className="kf-card p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
            <h3 className="text-sm font-semibold inline-flex items-center gap-1.5">API Keys <InfoBadge title="API Keys" body="HMAC-signed keys for programmatic access. Each key has scoped permissions — only grant what's needed. Store your key securely; it's shown only once." side="right" iconSize={12} /></h3>
          </div>
          <button
            onClick={() => { setShowCreateModal(true); setNewKey(null); }}
            className="kf-btn-primary px-3 py-1.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            Create Key
          </button>
        </div>

        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Shield className="w-3 h-3 shrink-0" />
          API keys grant programmatic access to your business data. Keep them secure.
        </div>

        {loading ? (
          <div className="py-6 text-center">
            <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
          </div>
        ) : apiKeys.length === 0 ? (
          <div className="py-8 text-center">
            <Key className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No API keys yet</p>
            <p className="text-xs text-muted-foreground/60">Create an API key to start integrating with external systems.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {apiKeys.map((key) => (
              <div key={key.id} className="flex items-center justify-between p-3 rounded-xl border border-border/40 hover:bg-muted/5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{key.name}</span>
                    <span className="text-[10px] font-mono text-muted-foreground bg-muted/30 px-1.5 py-0.5 rounded">{key.prefix}...****</span>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground mt-1">
                    <span>Created {new Date(key.createdAt).toLocaleDateString()}</span>
                    {key.lastUsed && <span>Last used {new Date(key.lastUsed).toLocaleDateString()}</span>}
                    <span>{key.scopes.length} scope{key.scopes.length !== 1 ? "s" : ""}</span>
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(key.id)}
                  disabled={deleting === key.id}
                  className="text-red-400/60 hover:text-red-400 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                >
                  {deleting === key.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {showCreateModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => { if (!newKey) setShowCreateModal(false); }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="kf-card p-6 w-full max-w-md space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              {newKey ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5" style={{ color: "hsl(var(--kf-success))" }} />
                    <h3 className="text-sm font-semibold">API Key Created</h3>
                  </div>
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
                    <p className="text-xs text-amber-400 mb-2">
                      Copy this key now. You won&apos;t be able to see it again.
                    </p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-xs font-mono bg-black/30 rounded p-2 break-all">
                        {showKey ? newKey : "••••••••••••••••••••••••••••••••"}
                      </code>
                      <button
                        onClick={() => setShowKey(!showKey)}
                        className="text-muted-foreground hover:text-foreground min-w-[44px] min-h-[44px] flex items-center justify-center"
                      >
                        {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={() => copyToClipboard(newKey)}
                        className="text-muted-foreground hover:text-foreground min-w-[44px] min-h-[44px] flex items-center justify-center"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <button
                    onClick={() => { setShowCreateModal(false); setNewKey(null); setShowKey(false); }}
                    className="kf-btn-primary w-full py-2 rounded-xl text-sm font-medium"
                  >
                    Done
                  </button>
                </div>
              ) : (
                <>
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <Key className="w-4 h-4" /> Create API Key
                  </h3>
                  <div>
                    <label className="text-xs text-muted-foreground">Key Name</label>
                    <input
                      value={form.name}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                      className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))] mt-1"
                      placeholder="My Integration"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-2 block">Permissions</label>
                    <div className="grid grid-cols-2 gap-1.5">
                      {AVAILABLE_SCOPES.map((scope) => (
                        <button
                          key={scope.value}
                          type="button"
                          onClick={() => toggleScope(scope.value)}
                          className={`text-left text-xs px-2.5 py-2 rounded-lg border transition-colors ${
                            form.scopes.has(scope.value)
                              ? "border-[hsl(var(--kf-accent1)_/_0.4)] bg-[hsl(var(--kf-accent1)_/_0.1)] text-foreground"
                              : "border-border/40 text-muted-foreground hover:bg-muted/10"
                          }`}
                        >
                          {form.scopes.has(scope.value) ? "✓ " : ""}{scope.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={handleCreate}
                      disabled={!form.name.trim() || form.scopes.size === 0 || creating}
                      className="kf-btn-primary flex-1 py-2 rounded-xl text-sm font-medium disabled:opacity-40"
                    >
                      {creating ? "Creating..." : "Create Key"}
                    </button>
                    <button
                      onClick={() => setShowCreateModal(false)}
                      className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-muted/30"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
