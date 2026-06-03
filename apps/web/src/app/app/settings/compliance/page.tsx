"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, Loader2, Search, Filter, CheckCircle2, XCircle, Clock, Mail, Phone, MessageSquare, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { apiGet } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";

interface ConsentRecord {
  id: string;
  contactId: string;
  channel: string;
  consentType: string;
  status: "granted" | "revoked" | "pending";
  source: string;
  evidence: Record<string, unknown> | null;
  grantedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

const CHANNEL_ICON: Record<string, React.ReactNode> = {
  email: <Mail className="w-3.5 h-3.5" />,
  sms: <Phone className="w-3.5 h-3.5" />,
  whatsapp: <MessageSquare className="w-3.5 h-3.5" />,
  call: <Volume2 className="w-3.5 h-3.5" />,
};

const STATUS_BADGE: Record<string, string> = {
  granted: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  revoked: "bg-rose-500/10 text-rose-400 border-rose-500/30",
  pending: "bg-amber-500/10 text-amber-400 border-amber-500/30",
};

const STATUS_ICON: Record<string, React.ReactNode> = {
  granted: <CheckCircle2 className="w-3 h-3" />,
  revoked: <XCircle className="w-3 h-3" />,
  pending: <Clock className="w-3 h-3" />,
};

export default function ComplianceSettingsPage() {
  const businessId = getStoredBusinessId();
  const [records, setRecords] = useState<ConsentRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [filterChannel, setFilterChannel] = useState<string>("");

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set("status", filterStatus);
      if (filterChannel) params.set("channel", filterChannel);
      const res = await apiGet<ConsentRecord[]>(
        `/api/communications/businesses/${businessId}/consent?${params.toString()}`
      );
      if (res.error) throw new Error(res.error);
      setRecords(res.data ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load consent records");
    } finally {
      setLoading(false);
    }
  }, [businessId, filterStatus, filterChannel]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = records.filter((r) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      r.contactId.toLowerCase().includes(q) ||
      r.channel.toLowerCase().includes(q) ||
      r.consentType.toLowerCase().includes(q) ||
      r.source.toLowerCase().includes(q)
    );
  });

  const granted = records.filter((r) => r.status === "granted").length;
  const revoked = records.filter((r) => r.status === "revoked").length;
  const pending = records.filter((r) => r.status === "pending").length;

  return (
    <div className="space-y-6 max-w-6xl mx-auto px-4 py-6">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center text-white shadow">
          <ShieldCheck className="w-4 h-4" />
        </div>
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Compliance & Consent</h2>
          <p className="text-xs text-muted-foreground">
            Review consent records across channels. Ensure GDPR and marketing compliance.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-2xl border border-border/50 bg-card/40 p-4 text-center">
          <div className="text-2xl font-semibold text-emerald-400">{granted}</div>
          <div className="text-[11px] text-muted-foreground uppercase tracking-wider mt-1">Granted</div>
        </div>
        <div className="rounded-2xl border border-border/50 bg-card/40 p-4 text-center">
          <div className="text-2xl font-semibold text-rose-400">{revoked}</div>
          <div className="text-[11px] text-muted-foreground uppercase tracking-wider mt-1">Revoked</div>
        </div>
        <div className="rounded-2xl border border-border/50 bg-card/40 p-4 text-center">
          <div className="text-2xl font-semibold text-amber-400">{pending}</div>
          <div className="text-[11px] text-muted-foreground uppercase tracking-wider mt-1">Pending</div>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search contact, channel, type..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-9 pl-9 pr-3 rounded-md border border-border/60 bg-background text-sm"
          />
        </div>
        <label className="flex flex-col text-xs text-muted-foreground">
          Status
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="">All</option>
            <option value="granted">Granted</option>
            <option value="revoked">Revoked</option>
            <option value="pending">Pending</option>
          </select>
        </label>
        <label className="flex flex-col text-xs text-muted-foreground">
          Channel
          <select
            value={filterChannel}
            onChange={(e) => setFilterChannel(e.target.value)}
            className="mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="">All</option>
            <option value="email">Email</option>
            <option value="sms">SMS</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="call">Call</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="h-9 px-3 rounded-md border border-border/60 bg-background text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Filter className="w-4 h-4" />}
        </button>
      </div>

      <div className="rounded-2xl border border-border/50 bg-card/40 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full w-full text-xs">
            <thead className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/50 bg-muted/30">
              <tr>
                <th className="text-left py-2.5 px-4">Contact</th>
                <th className="text-left py-2.5 px-4">Channel</th>
                <th className="text-left py-2.5 px-4">Type</th>
                <th className="text-left py-2.5 px-4">Status</th>
                <th className="text-left py-2.5 px-4">Source</th>
                <th className="text-left py-2.5 px-4">Date</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-muted-foreground">
                    {loading ? (
                      <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                    ) : (
                      "No consent records found."
                    )}
                  </td>
                </tr>
              ) : (
                filtered.map((r) => (
                  <tr key={r.id} className="border-b border-border/30 hover:bg-accent/30 transition-colors">
                    <td className="py-2.5 px-4 font-mono text-[11px]">{r.contactId.slice(0, 12)}…</td>
                    <td className="py-2.5 px-4">
                      <div className="flex items-center gap-1.5">
                        {CHANNEL_ICON[r.channel] ?? <MessageSquare className="w-3.5 h-3.5" />}
                        <span className="capitalize">{r.channel}</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-4 capitalize">{r.consentType}</td>
                    <td className="py-2.5 px-4">
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] ${STATUS_BADGE[r.status] ?? STATUS_BADGE.pending}`}>
                        {STATUS_ICON[r.status]}
                        {r.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-muted-foreground">{r.source}</td>
                    <td className="py-2.5 px-4 text-muted-foreground whitespace-nowrap">
                      {new Date(r.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
