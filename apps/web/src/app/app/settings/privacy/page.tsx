"use client";

import { useEffect, useState } from "react";
import { Shield, Save, Loader2, AlertCircle, History } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPatch } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";

interface ForgetRequest {
  id: string;
  contactId: string;
  status: string;
  reason: string | null;
  requestedAt: string;
  purgeAt: string;
  purgedAt: string | null;
  cancelledAt: string | null;
}

interface PrivacySettings {
  forgetGraceDays: number;
  defaultForgetReason: string | null;
  recentForget: ForgetRequest[];
}

const STATUS_TONE: Record<string, string> = {
  requested: "bg-orange-500/10 text-orange-400 border-orange-500/30",
  purged: "bg-red-500/10 text-red-400 border-red-500/30",
  cancelled: "bg-muted text-muted-foreground border-border",
};

export default function PrivacySettingsPage() {
  const [activeBusinessId, setActiveBusinessId] = useState<string | null>(null);
  useEffect(() => { setActiveBusinessId(getStoredBusinessId()); }, []);
  const [settings, setSettings] = useState<PrivacySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [graceDays, setGraceDays] = useState(7);
  const [defaultReason, setDefaultReason] = useState("");

  const load = async () => {
    if (!activeBusinessId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<PrivacySettings>(
        `/crm/businesses/${activeBusinessId}/privacy-settings`,
      );
      if (res.error || !res.data) throw new Error(res.error || "Failed to load privacy settings");
      const data = res.data;
      setSettings(data);
      setGraceDays(data.forgetGraceDays);
      setDefaultReason(data.defaultForgetReason ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activeBusinessId]);

  const save = async () => {
    if (!activeBusinessId) return;
    setSaving(true);
    try {
      const res = await apiPatch<PrivacySettings>(
        `/crm/businesses/${activeBusinessId}/privacy-settings`,
        {
          forgetGraceDays: graceDays,
          defaultForgetReason: defaultReason.trim() || null,
        },
      );
      if (res.error || !res.data) throw new Error(res.error || "Failed to save");
      setSettings(res.data);
      toast.success("Privacy settings saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center text-white shadow">
          <Shield className="w-4 h-4" />
        </div>
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Privacy & GDPR</h2>
          <p className="text-xs text-muted-foreground">
            Configure how long deleted contact data lingers before being permanently purged,
            review recent forget requests, and pre-fill compliance reasons.
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg border border-red-500/30 bg-red-500/5 text-sm text-red-400">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <div className="rounded-2xl border border-border/50 bg-card/40 p-5 space-y-4">
        <h3 className="text-sm font-semibold">Forget grace window</h3>
        <p className="text-xs text-muted-foreground">
          When an operator forgets a contact, the contact is soft-deleted (recoverable) for
          this many days, then permanently purged and identifiers in the audit log are
          replaced with one-way hashes.
        </p>
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="space-y-1.5">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Grace window (days)</div>
            <input
              type="number"
              min={0}
              max={90}
              value={graceDays}
              onChange={(e) => setGraceDays(Math.max(0, Math.min(90, Number(e.target.value) || 0)))}
              className="w-full h-9 rounded-md border border-border/60 bg-background px-3 text-sm"
            />
            <div className="text-[10px] text-muted-foreground/70">
              0 = immediate purge · max 90 days. Operators can still cancel during the window.
            </div>
          </label>
          <label className="space-y-1.5">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Default forget reason</div>
            <input
              type="text"
              maxLength={500}
              value={defaultReason}
              onChange={(e) => setDefaultReason(e.target.value)}
              placeholder="e.g. customer GDPR request"
              className="w-full h-9 rounded-md border border-border/60 bg-background px-3 text-sm"
            />
            <div className="text-[10px] text-muted-foreground/70">
              Pre-filled into the Forget dialog. Operators can override per request.
            </div>
          </label>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || loading}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-md bg-[hsl(var(--kf-accent1))] text-white text-sm font-medium disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save settings
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-border/50 bg-card/40 p-5 space-y-3">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Recent forget requests</h3>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : !settings || settings.recentForget.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">
            No forget requests yet.
          </p>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/50">
                <tr>
                  <th className="text-left py-2 pr-4">Contact</th>
                  <th className="text-left py-2 pr-4">Status</th>
                  <th className="text-left py-2 pr-4">Reason</th>
                  <th className="text-left py-2 pr-4">Requested</th>
                  <th className="text-left py-2 pr-4">Purge at</th>
                </tr>
              </thead>
              <tbody>
                {settings.recentForget.map((r) => (
                  <tr key={r.id} className="border-b border-border/30">
                    <td className="py-2 pr-4 font-mono text-[11px]">{r.contactId.slice(0, 12)}…</td>
                    <td className="py-2 pr-4">
                      <span className={`px-1.5 py-0.5 rounded border text-[10px] ${STATUS_TONE[r.status] ?? STATUS_TONE.cancelled}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground max-w-xs truncate">{r.reason || "—"}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{new Date(r.requestedAt).toLocaleString()}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{new Date(r.purgeAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
