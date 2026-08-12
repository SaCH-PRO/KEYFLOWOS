"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Users,
  RefreshCw,
  Loader2,
  Save,
  Tag,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { Button, Badge } from "@keyflow/ui";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { apiGet, apiPostSimple, apiPut } from "@/lib/api";

interface SyncProgress {
  phase: string;
  pagesFetched: number;
  processed: number;
  imported: number;
  updated: number;
  startedAt: string;
  finishedAt?: string;
}

interface ContactStatus {
  connected: boolean;
  account: string | null;
  lastSyncAt: string | null;
  lastImportAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  syncCount: number;
  totalContacts: number;
  googleContacts: number;
  mappingRules: {
    defaultTags: string[];
    defaultStatus: string | null;
    defaultOwnerId: string | null;
    defaultLifecycleStage: string | null;
  };
  syncProgress: SyncProgress | null;
}

interface SyncSummary {
  imported: number;
  updated: number;
  created: number;
  matched: number;
  skipped: number;
}

interface RecentContact {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  companyName: string | null;
  status: string | null;
  tags: string[];
  externalId: string;
  syncedAt: string;
  firstSyncedAt: string;
  createdAt: string;
}

interface TeamMember {
  membershipId?: string;
  userId?: string;
  id?: string;
  email?: string | null;
  name?: string | null;
  role?: string | null;
}

const STATUS_OPTIONS = ["LEAD", "PROSPECT", "ACTIVE", "INACTIVE", "ARCHIVED"];
const LIFECYCLE_OPTIONS = [
  "subscriber",
  "lead",
  "marketing_qualified",
  "sales_qualified",
  "opportunity",
  "customer",
  "evangelist",
];

function formatTimeAgo(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

interface ContactSyncSettingsProps {
  businessId: string;
  type: "google_contacts" | "outlook_contacts";
}

export function ContactSyncSettings({ businessId, type }: ContactSyncSettingsProps) {
  const apiPrefix = type === "google_contacts" ? "contacts" : "outlook-contacts";
  const providerLabel = type === "google_contacts" ? "Google Contacts" : "Outlook Contacts";

  const [status, setStatus] = useState<ContactStatus | null>(null);
  const [recent, setRecent] = useState<RecentContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [savingRules, setSavingRules] = useState(false);
  const [tagsDraft, setTagsDraft] = useState("");
  const [statusDraft, setStatusDraft] = useState("");
  const [lifecycleDraft, setLifecycleDraft] = useState("");
  const [ownerDraft, setOwnerDraft] = useState("");
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [lastSummary, setLastSummary] = useState<SyncSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [statusRes, recentRes, teamRes] = await Promise.all([
      apiGet<ContactStatus>(`/connect/businesses/${businessId}/${apiPrefix}/status`),
      apiGet<RecentContact[]>(`/connect/businesses/${businessId}/${apiPrefix}/recent?limit=25`),
      apiGet<TeamMember[] | { members?: TeamMember[] }>(`/identity/businesses/${businessId}/team`),
    ]);
    if (statusRes.error) setError(statusRes.error);
    if (statusRes.data) {
      setStatus(statusRes.data);
      const r = statusRes.data.mappingRules;
      setTagsDraft((r.defaultTags ?? []).join(", "));
      setStatusDraft(r.defaultStatus ?? "");
      setLifecycleDraft(r.defaultLifecycleStage ?? "");
      setOwnerDraft(r.defaultOwnerId ?? "");
    }
    if (recentRes.data) setRecent(recentRes.data);
    if (teamRes.data) {
      const list = Array.isArray(teamRes.data)
        ? teamRes.data
        : (teamRes.data.members ?? []);
      setTeam(list);
    }
    setLoading(false);
  }, [businessId, apiPrefix]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async hydration of server data into local state
    load();
  }, [load]);

  const handleSync = async () => {
    setSyncing(true);
    setLastSummary(null);
    const poll = setInterval(async () => {
      const r = await apiGet<ContactStatus>(`/connect/businesses/${businessId}/${apiPrefix}/status`);
      if (r.data) setStatus(r.data);
    }, 1500);
    const res = await apiPostSimple<SyncSummary>(
      `/connect/businesses/${businessId}/${apiPrefix}/sync`,
      {},
    );
    clearInterval(poll);
    setSyncing(false);
    if (res.error) {
      toast.error(res.error);
    } else if (res.data) {
      setLastSummary(res.data);
      toast.success(
        `Created ${res.data.created} new contacts, matched & enriched ${res.data.matched} existing`,
      );
      await load();
    }
  };

  const handleSaveRules = async () => {
    setSavingRules(true);
    const tags = tagsDraft
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const res = await apiPut(
      `/connect/businesses/${businessId}/${apiPrefix}/mapping-rules`,
      {
        defaultTags: tags,
        defaultStatus: statusDraft || null,
        defaultLifecycleStage: lifecycleDraft || null,
        defaultOwnerId: ownerDraft || null,
      },
    );
    setSavingRules(false);
    if (res.error) {
      toast.error(res.error);
    } else {
      toast.success("Mapping rules saved");
      await load();
    }
  };

  const counts = useMemo(
    () => ({
      total: status?.totalContacts ?? 0,
      google: status?.googleContacts ?? 0,
      synced: status?.syncCount ?? 0,
    }),
    [status],
  );

  return (
    <div className="space-y-5">
      <PageHeader
        icon={Users}
        title={providerLabel}
        subtitle={
          status?.connected
            ? `Connected as ${status.account ?? "account"}.`
            : `Connect ${providerLabel} on the Key Connect page to sync your address book.`
        }
        rightSlot={
          <div className="flex items-center gap-2">
            <Link
              href="/app/crm/contacts?view=table"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground border border-border/50 px-2 py-1 rounded-lg"
            >
              <ExternalLink className="h-3 w-3" />
              View all CRM contacts
            </Link>
            <Button
              size="sm"
              onClick={handleSync}
              disabled={syncing || !status?.connected}
            >
              {syncing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              )}
              Sync now
            </Button>
          </div>
        }
      />

      {(syncing || (status?.syncProgress && !status.syncProgress.finishedAt)) && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs">
          <div className="flex items-center gap-2 mb-1">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-400" />
            <span className="font-medium">
              Syncing — {status?.syncProgress?.phase ?? "starting"}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-muted-foreground">
            <span>Pages: {status?.syncProgress?.pagesFetched ?? 0}</span>
            <span>Scanned: {status?.syncProgress?.processed ?? 0}</span>
            <span>Created: {status?.syncProgress?.imported ?? 0}</span>
            <span>Matched: {status?.syncProgress?.updated ?? 0}</span>
          </div>
        </div>
      )}

      {lastSummary && !syncing && (
        <div className="rounded-2xl border border-border/40 bg-card/40 p-3 text-xs flex flex-wrap items-center gap-3">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          <span className="font-medium">Last sync summary:</span>
          <Badge tone="success" className="text-[10px]">
            {lastSummary.created} created
          </Badge>
          <Badge tone="info" className="text-[10px]">
            {lastSummary.matched} matched & enriched
          </Badge>
          <Badge tone="default" className="text-[10px]">
            {lastSummary.skipped} skipped
          </Badge>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300 inline-flex items-center gap-2">
          <AlertCircle className="h-3.5 w-3.5" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="h-72 rounded-2xl bg-muted/10 border border-border/20 animate-pulse" />
      ) : !status?.connected ? (
        <EmptyState
          icon={Users}
          title={`${providerLabel} isn’t connected`}
          description={`Connect ${providerLabel} from Key Connect, then come back to sync.`}
          actionLabel="Open Key Connect"
          onAction={() => (window.location.href = "/app/key-connect")}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-2xl border border-border/40 bg-card/40 p-4">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Last sync
              </div>
              <div className="text-lg font-semibold mt-1">
                {formatTimeAgo(status.lastSyncAt)}
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">
                {counts.synced} sync{counts.synced === 1 ? "" : "s"} run
              </div>
            </div>
            <div className="rounded-2xl border border-border/40 bg-card/40 p-4">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                From {type === "google_contacts" ? "Google" : "Outlook"}
              </div>
              <div className="text-lg font-semibold mt-1">{counts.google}</div>
              <div className="text-[11px] text-muted-foreground mt-1">
                {counts.total} total contacts in CRM
              </div>
            </div>
            <div className="rounded-2xl border border-border/40 bg-card/40 p-4">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Status
              </div>
              <div className="text-lg font-semibold mt-1 inline-flex items-center gap-1.5">
                {status.lastError ? (
                  <span className="text-red-400 inline-flex items-center gap-1.5">
                    <AlertCircle className="h-4 w-4" />
                    Last error
                  </span>
                ) : (
                  <span className="text-emerald-400 inline-flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4" />
                    Healthy
                  </span>
                )}
              </div>
              {status.lastError && (
                <div className="text-[11px] text-red-300 mt-1 line-clamp-2">
                  {status.lastError}
                </div>
              )}
            </div>
          </div>

          <section className="rounded-2xl border border-border/50 bg-card/40 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Tag className="h-4 w-4 text-amber-400" />
              <h3 className="text-sm font-semibold">Default mapping rules</h3>
              <span className="text-[11px] text-muted-foreground">
                Applied to every newly imported contact.
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
                  Default owner
                </label>
                <select
                  value={ownerDraft}
                  onChange={(e) => setOwnerDraft(e.target.value)}
                  className="w-full rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-sm"
                >
                  <option value="">— Unassigned —</option>
                  {team.map((m) => {
                    const id = m.userId ?? m.id ?? m.membershipId ?? "";
                    const label = m.name ?? m.email ?? id;
                    if (!id) return null;
                    return (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
                  Default tags (comma separated)
                </label>
                <input
                  value={tagsDraft}
                  onChange={(e) => setTagsDraft(e.target.value)}
                  placeholder="google, imported"
                  className="w-full rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1)/0.5)]"
                />
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
                  Default status
                </label>
                <select
                  value={statusDraft}
                  onChange={(e) => setStatusDraft(e.target.value)}
                  className="w-full rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-sm"
                >
                  <option value="">— No change —</option>
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
                  Default lifecycle stage
                </label>
                <select
                  value={lifecycleDraft}
                  onChange={(e) => setLifecycleDraft(e.target.value)}
                  className="w-full rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-sm"
                >
                  <option value="">— No change —</option>
                  {LIFECYCLE_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end mt-3">
              <Button size="sm" onClick={handleSaveRules} disabled={savingRules}>
                {savingRules ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                ) : (
                  <Save className="h-3 w-3 mr-1" />
                )}
                Save rules
              </Button>
            </div>
          </section>

          <section>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Recently synced
            </h3>
            {recent.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/40 p-6 text-center text-xs text-muted-foreground">
                No contacts have been imported yet. Run a sync to pull them in.
              </div>
            ) : (
              <div className="rounded-2xl border border-border/40 bg-card/40 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="min-w-full w-full text-xs">
                    <thead className="text-[10px] uppercase tracking-wider text-muted-foreground bg-muted/10">
                      <tr>
                        <th className="text-left px-3 py-2">Name</th>
                        <th className="text-left px-3 py-2">Email / phone</th>
                        <th className="text-left px-3 py-2">Tags</th>
                        <th className="text-left px-3 py-2">Synced</th>
                        <th className="px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {recent.map((c) => (
                        <tr
                          key={c.id}
                          className="border-t border-border/30 hover:bg-muted/10"
                        >
                          <td className="px-3 py-2">
                            <div className="font-medium">
                              {[c.firstName, c.lastName].filter(Boolean).join(" ") ||
                                "—"}
                            </div>
                            {c.companyName && (
                              <div className="text-[10px] text-muted-foreground">
                                {c.companyName}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <div>{c.email ?? "—"}</div>
                            {c.phone && (
                              <div className="text-[10px] text-muted-foreground">
                                {c.phone}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-1">
                              {(c.tags ?? []).slice(0, 3).map((t) => (
                                <Badge key={t} className="text-[9px]">
                                  {t}
                                </Badge>
                              ))}
                              {c.status && (
                                <Badge tone="info" className="text-[9px]">
                                  {c.status}
                                </Badge>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {formatTimeAgo(c.syncedAt)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Link
                              href={`/app/crm/contacts/${c.id}`}
                              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                            >
                              Open
                              <ChevronRight className="h-3 w-3" />
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
