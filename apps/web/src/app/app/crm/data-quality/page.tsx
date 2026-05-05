"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Filter,
  Loader2,
  RefreshCw,
  Settings as SettingsIcon,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import {
  applyDataQualityFix,
  bulkApplyDataQualityFix,
  dismissDataQualityIssue,
  fetchDataQualityIssues,
  fetchDataQualityStats,
  fetchDataQualityWizard,
  runDataQualityScan,
  updateDataQualitySettings,
  type DataQualityIssue,
  type DataQualityKind,
  type DataQualityStats,
} from "@/lib/client";
import { ensureWorkspace, getStoredBusinessId } from "@/lib/workspace";

const KIND_META: Record<DataQualityKind, { label: string; cls: string; description: string }> = {
  invalid_email: { label: "Invalid email", cls: "bg-red-500/15 text-red-500", description: "Bad syntax or no MX record" },
  invalid_phone: { label: "Invalid phone", cls: "bg-orange-500/15 text-orange-500", description: "Cannot be normalised to E.164" },
  missing_required: { label: "Missing required", cls: "bg-amber-500/15 text-amber-500", description: "Required for this contact's relationship type" },
  stale_data: { label: "Stale data", cls: "bg-blue-500/15 text-blue-500", description: "Not verified in a long time" },
  suspected_duplicate: { label: "Possible duplicate", cls: "bg-purple-500/15 text-purple-500", description: "Matches another contact" },
};

const ALL_KINDS: DataQualityKind[] = [
  "invalid_email",
  "invalid_phone",
  "missing_required",
  "stale_data",
  "suspected_duplicate",
];

function contactName(c: DataQualityIssue["contact"]) {
  if (!c) return "Unknown contact";
  return c.displayName || `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || c.email || c.phone || "Unknown contact";
}

function scoreColor(score: number | null | undefined) {
  if (score == null) return "text-muted-foreground";
  if (score >= 85) return "text-emerald-500";
  if (score >= 60) return "text-amber-500";
  return "text-red-500";
}

export default function DataQualityPage() {
  const [businessId, setBusinessId] = useState<string | null>(() => getStoredBusinessId());
  const [stats, setStats] = useState<DataQualityStats | null>(null);
  const [issues, setIssues] = useState<DataQualityIssue[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterKinds, setFilterKinds] = useState<DataQualityKind[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [staleDays, setStaleDays] = useState<number>(180);
  const [wizardOpen, setWizardOpen] = useState(false);

  useEffect(() => {
    if (businessId) return;
    let cancelled = false;
    ensureWorkspace().then((id) => { if (!cancelled && id) setBusinessId(id); }).catch(() => {});
    return () => { cancelled = true; };
  }, [businessId]);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError(null);
    try {
      const [statsRes, issuesRes] = await Promise.all([
        fetchDataQualityStats(businessId),
        fetchDataQualityIssues(businessId, { kinds: filterKinds.length ? filterKinds : undefined, search: search.trim() || undefined, limit: 100 }),
      ]);
      if (statsRes.data) {
        setStats(statsRes.data);
        setStaleDays(statsRes.data.staleDays);
      }
      if (issuesRes.data) {
        setIssues(issuesRes.data.items);
        setTotal(issuesRes.data.total);
      } else if (issuesRes.error) {
        setError(issuesRes.error);
      }
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [businessId, filterKinds, search]);

  useEffect(() => { void load(); }, [load]);

  const toggleKind = (kind: DataQualityKind) => {
    setFilterKinds((curr) => (curr.includes(kind) ? curr.filter((k) => k !== kind) : [...curr, kind]));
  };

  const toggleSelect = (id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleScan = async () => {
    if (!businessId) return;
    setScanning(true);
    try {
      const { data, error: err } = await runDataQualityScan(businessId);
      if (err || !data) throw new Error(err || "Scan failed");
      toast.success(`Scanned ${data.scanned} contacts`, { description: `${data.issuesUpserted} issues found, ${data.issuesResolved} resolved` });
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  };

  const handleApply = async (issue: DataQualityIssue) => {
    if (!businessId) return;
    setBusy(true);
    try {
      // For suspected_duplicate, link to the duplicates page rather than auto-merging.
      if (issue.kind === "suspected_duplicate") {
        const fix = issue.recommendedFix as { primaryId?: string; duplicateId?: string } | null;
        const url = `/app/crm/duplicates${fix?.primaryId && fix?.duplicateId ? `?primaryId=${fix.primaryId}&duplicateId=${fix.duplicateId}` : ""}`;
        window.location.href = url;
        return;
      }
      const { data, error: err } = await applyDataQualityFix(businessId, issue.id);
      if (err || !data) throw new Error(err || "Failed");
      toast.success("Fix applied");
      setIssues((curr) => curr.filter((i) => i.id !== issue.id));
      setSelected((s) => { const n = new Set(s); n.delete(issue.id); return n; });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const handleDismiss = async (issue: DataQualityIssue) => {
    if (!businessId) return;
    setBusy(true);
    try {
      const { data, error: err } = await dismissDataQualityIssue(businessId, issue.id);
      if (err || !data) throw new Error(err || "Failed");
      setIssues((curr) => curr.filter((i) => i.id !== issue.id));
      setSelected((s) => { const n = new Set(s); n.delete(issue.id); return n; });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const handleBulkApply = async () => {
    if (!businessId || selected.size === 0) return;
    const ids = Array.from(selected).filter((id) => {
      const issue = issues.find((i) => i.id === id);
      return issue && issue.kind !== "suspected_duplicate";
    });
    if (ids.length === 0) {
      toast.info("Select non-duplicate issues to bulk-fix");
      return;
    }
    setBusy(true);
    try {
      const { data, error: err } = await bulkApplyDataQualityFix(businessId, ids);
      if (err || !data) throw new Error(err || "Bulk fix failed");
      toast.success(`Applied ${data.applied} fixes`, { description: data.failed ? `${data.failed} failed` : undefined });
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Bulk fix failed");
    } finally {
      setBusy(false);
    }
  };

  const handleSaveSettings = async () => {
    if (!businessId) return;
    try {
      const { data, error: err } = await updateDataQualitySettings(businessId, { staleDays });
      if (err || !data) throw new Error(err || "Failed");
      toast.success("Settings saved");
      setShowSettings(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const headerCount = useMemo(() => total || issues.length, [total, issues]);

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/app/crm/pipeline" className="p-2 rounded-lg hover:bg-muted/40" aria-label="Back to CRM">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-amber-500" /> Data quality
            </h1>
            <p className="text-xs text-muted-foreground">
              {headerCount} open issue{headerCount !== 1 ? "s" : ""} across your contacts
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWizardOpen(true)}
            className="kf-btn-primary text-xs flex items-center gap-1.5"
            data-testid="open-wizard"
          >
            <Wand2 className="w-3.5 h-3.5" /> Clean my contacts
          </button>
          <button
            onClick={handleScan}
            disabled={scanning}
            className="kf-btn-secondary text-xs flex items-center gap-1.5 disabled:opacity-50"
          >
            {scanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Run scan
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="p-2 rounded-lg hover:bg-muted/40"
            aria-label="Settings"
          >
            <SettingsIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="kf-card p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Avg score</div>
          <div className={`text-2xl font-semibold ${scoreColor(stats?.averageScore ?? 100)}`}>{stats?.averageScore ?? "—"}</div>
        </div>
        <div className="kf-card p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Contacts</div>
          <div className="text-2xl font-semibold">{stats?.totalContacts ?? 0}</div>
        </div>
        <div className="kf-card p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Open issues</div>
          <div className="text-2xl font-semibold">{stats ? Object.values(stats.issueCounts).reduce((a, b) => a + b, 0) : 0}</div>
        </div>
        <div className="kf-card p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Last scan</div>
          <div className="text-sm">
            {stats?.lastRunAt ? new Date(stats.lastRunAt).toLocaleString() : "Never"}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="kf-card p-3 flex flex-wrap items-center gap-2">
        <Filter className="w-4 h-4 text-muted-foreground" />
        {ALL_KINDS.map((k) => {
          const active = filterKinds.includes(k);
          const meta = KIND_META[k];
          const count = stats?.issueCounts?.[k] ?? 0;
          return (
            <button
              key={k}
              onClick={() => toggleKind(k)}
              className={`text-xs px-2 py-1 rounded-full border transition ${active ? meta.cls + " border-transparent" : "border-border/40 text-muted-foreground hover:bg-muted/30"}`}
            >
              {meta.label} <span className="opacity-60">({count})</span>
            </button>
          );
        })}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void load(); }}
          placeholder="Search contact name, email, phone…"
          className="flex-1 min-w-[180px] text-xs px-2 py-1.5 rounded border border-border/40 bg-background"
        />
      </div>

      {selected.size > 0 && (
        <div className="kf-card p-3 flex items-center gap-3 bg-[hsl(var(--kf-accent2))]/5 border-[hsl(var(--kf-accent2))]/30">
          <CheckCircle2 className="w-4 h-4 text-[hsl(var(--kf-accent2))]" />
          <span className="text-sm flex-1">{selected.size} selected</span>
          <button onClick={() => setSelected(new Set())} className="text-xs text-muted-foreground hover:underline">Clear</button>
          <button
            onClick={handleBulkApply}
            disabled={busy}
            className="text-xs px-3 py-1.5 rounded-lg bg-[hsl(var(--kf-accent2))]/15 text-[hsl(var(--kf-accent2))] hover:bg-[hsl(var(--kf-accent2))]/25 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            Apply suggested fixes
          </button>
        </div>
      )}

      {error && (
        <div className="kf-card p-4 border border-[hsl(var(--kf-error))]/30 bg-[hsl(var(--kf-error))]/5 flex items-center gap-3">
          <AlertTriangle className="w-4 h-4 text-[hsl(var(--kf-error))]" />
          <span className="text-sm flex-1">{error}</span>
          <button onClick={() => load()} className="kf-btn-secondary text-xs">Retry</button>
        </div>
      )}

      {loading && issues.length === 0 && (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Scanning your contacts…
        </div>
      )}

      {!loading && issues.length === 0 && !error && (
        <div className="kf-card p-8 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
          <ShieldCheck className="w-8 h-8 text-emerald-500" />
          Your contacts look clean. Run a scan to recheck.
        </div>
      )}

      <div className="space-y-2">
        {issues.map((issue) => {
          const meta = KIND_META[issue.kind];
          const fix = issue.recommendedFix as { value?: unknown } | null;
          const suggestion = fix && typeof fix.value === "string" ? fix.value : null;
          return (
            <div key={issue.id} className="kf-card p-3 flex items-start gap-3">
              <input
                type="checkbox"
                checked={selected.has(issue.id)}
                onChange={() => toggleSelect(issue.id)}
                className="mt-1"
                aria-label={`Select ${contactName(issue.contact)}`}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Link href={`/app/crm/contacts/${issue.contactId}`} className="text-sm font-medium hover:underline truncate">
                    {contactName(issue.contact)}
                  </Link>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${meta.cls}`}>{meta.label}</span>
                  <span className={`text-[10px] ${scoreColor(issue.contact?.dataQualityScore)}`}>
                    score {issue.contact?.dataQualityScore ?? "—"}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">{issue.message}</div>
                {suggestion && (
                  <div className="text-xs mt-1">
                    Suggested: <span className="font-mono px-1 rounded bg-muted/40">{suggestion}</span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => handleDismiss(issue)}
                  disabled={busy}
                  className="p-2 rounded hover:bg-muted/40 text-muted-foreground"
                  aria-label="Dismiss issue"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => handleApply(issue)}
                  disabled={busy}
                  className="text-xs px-3 py-1.5 rounded-lg bg-[hsl(var(--kf-accent2))]/10 text-[hsl(var(--kf-accent2))] hover:bg-[hsl(var(--kf-accent2))]/20 disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  {issue.kind === "suspected_duplicate" ? "Review merge" : "Apply fix"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {showSettings && (
        <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4" onClick={() => setShowSettings(false)}>
          <div className="bg-background rounded-lg shadow-xl p-4 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold">Data quality settings</h2>
              <button onClick={() => setShowSettings(false)} aria-label="Close" className="p-1 hover:bg-muted/40 rounded">
                <X className="w-4 h-4" />
              </button>
            </div>
            <label className="block text-xs text-muted-foreground mb-1">Stale data threshold (days)</label>
            <input
              type="number"
              min={7}
              max={365}
              value={staleDays}
              onChange={(e) => setStaleDays(Number(e.target.value))}
              className="w-full text-sm px-2 py-1.5 rounded border border-border/40 bg-background"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Contacts not verified in this many days will be flagged as stale.
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowSettings(false)} className="kf-btn-secondary text-xs">Cancel</button>
              <button onClick={handleSaveSettings} className="kf-btn-primary text-xs">Save</button>
            </div>
          </div>
        </div>
      )}

      {wizardOpen && businessId && (
        <CleanWizard
          businessId={businessId}
          onClose={() => { setWizardOpen(false); void load(); }}
        />
      )}
    </div>
  );
}

function CleanWizard({ businessId, onClose }: { businessId: string; onClose: () => void }) {
  const [items, setItems] = useState<DataQualityIssue[]>([]);
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState({ applied: 0, skipped: 0 });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchDataQualityWizard(businessId, 25)
      .then(({ data }) => {
        if (cancelled) return;
        setItems((data?.items ?? []) as DataQualityIssue[]);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [businessId]);

  const current = items[idx];

  const next = () => setIdx((i) => i + 1);

  const apply = async () => {
    if (!current) return;
    setBusy(true);
    try {
      if (current.kind === "suspected_duplicate") {
        const fix = current.recommendedFix as { primaryId?: string; duplicateId?: string } | null;
        const url = `/app/crm/duplicates${fix?.primaryId && fix?.duplicateId ? `?primaryId=${fix.primaryId}&duplicateId=${fix.duplicateId}` : ""}`;
        window.open(url, "_blank");
        setDone((d) => ({ ...d, skipped: d.skipped + 1 }));
        next();
        return;
      }
      const { data, error } = await applyDataQualityFix(businessId, current.id);
      if (error || !data) throw new Error(error || "Failed");
      setDone((d) => ({ ...d, applied: d.applied + 1 }));
      next();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const skip = async () => {
    if (!current) return;
    setBusy(true);
    try {
      await dismissDataQualityIssue(businessId, current.id);
      setDone((d) => ({ ...d, skipped: d.skipped + 1 }));
      next();
    } finally {
      setBusy(false);
    }
  };

  const finished = !loading && items.length > 0 && idx >= items.length;
  const empty = !loading && items.length === 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-background rounded-xl shadow-2xl p-5 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Wand2 className="w-4 h-4 text-[hsl(var(--kf-accent2))]" />
            Clean my contacts
          </h2>
          <button onClick={onClose} aria-label="Close" className="p-1 hover:bg-muted/40 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Finding the most important issues…
          </div>
        )}

        {empty && (
          <div className="text-center py-10 text-sm text-muted-foreground">
            <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
            Nothing urgent to clean. Nice work.
          </div>
        )}

        {finished && (
          <div className="text-center py-10">
            <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
            <div className="text-sm font-medium">All done!</div>
            <div className="text-xs text-muted-foreground">Applied {done.applied}, skipped {done.skipped}</div>
            <button onClick={onClose} className="kf-btn-primary text-xs mt-4">Close</button>
          </div>
        )}

        {!loading && current && !finished && (
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">Step {idx + 1} of {items.length}</div>
            <div className="rounded-lg border border-border/40 p-3">
              <div className="text-sm font-medium">{contactName(current.contact)}</div>
              <div className="text-xs text-muted-foreground mt-1">{KIND_META[current.kind].label}</div>
              <div className="text-xs mt-2">{current.message}</div>
              {current.recommendedFix && typeof (current.recommendedFix as { value?: unknown }).value === "string" && (
                <div className="text-xs mt-2">
                  Suggested: <span className="font-mono px-1 rounded bg-muted/40">{String((current.recommendedFix as { value: string }).value)}</span>
                </div>
              )}
            </div>
            <div className="flex justify-between gap-2">
              <button onClick={skip} disabled={busy} className="kf-btn-secondary text-xs">Skip</button>
              <button onClick={apply} disabled={busy} className="kf-btn-primary text-xs inline-flex items-center gap-1.5">
                {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                {current.kind === "suspected_duplicate" ? "Open merge" : "Apply fix"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
