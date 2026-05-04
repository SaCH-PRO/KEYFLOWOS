"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Flag, Lock, Save, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiGet, apiPut } from "@/lib/api";

interface FeatureFlag {
  id: string;
  key: string;
  label: string;
  category: string | null;
  comingSoon: boolean;
  bypassEmails: string[];
  createdAt: string;
  updatedAt: string;
}

interface DraftState {
  comingSoon: boolean;
  bypassEmailsText: string;
  saving: boolean;
  error: string | null;
  saved: boolean;
}

function emptyDraft(flag: FeatureFlag): DraftState {
  return {
    comingSoon: flag.comingSoon,
    bypassEmailsText: flag.bypassEmails.join("\n"),
    saving: false,
    error: null,
    saved: false,
  };
}

export default function AdminFeatureFlagsPage() {
  const [flags, setFlags] = useState<FeatureFlag[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftState>>({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const res = await apiGet<{ flags: FeatureFlag[] }>("/api/admin/feature-flags");
    if (res.error || !res.data) {
      setLoadError(res.error ?? "Failed to load feature flags");
      setFlags([]);
    } else {
      setFlags(res.data.flags);
      setDrafts(
        Object.fromEntries(res.data.flags.map((f) => [f.key, emptyDraft(f)])),
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async hydration: load admin feature flags from the server on mount
    load();
  }, [load]);

  const grouped = useMemo(() => {
    const map = new Map<string, FeatureFlag[]>();
    for (const f of flags ?? []) {
      const key = f.category ?? "Other";
      const list = map.get(key) ?? [];
      list.push(f);
      map.set(key, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [flags]);

  const updateDraft = (key: string, patch: Partial<DraftState>) => {
    setDrafts((prev) => ({
      ...prev,
      [key]: { ...prev[key], ...patch, saved: false },
    }));
  };

  const save = async (flag: FeatureFlag) => {
    const draft = drafts[flag.key];
    if (!draft) return;
    const bypassEmails = draft.bypassEmailsText
      .split(/[\s,;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0);

    setDrafts((prev) => ({
      ...prev,
      [flag.key]: { ...prev[flag.key], saving: true, error: null, saved: false },
    }));

    const res = await apiPut<{ flag: FeatureFlag }>(
      `/api/admin/feature-flags/${encodeURIComponent(flag.key)}`,
      { comingSoon: draft.comingSoon, bypassEmails },
    );

    if (res.error || !res.data) {
      setDrafts((prev) => ({
        ...prev,
        [flag.key]: {
          ...prev[flag.key],
          saving: false,
          error: res.error ?? "Failed to save",
        },
      }));
      return;
    }

    const updated = res.data.flag;
    setFlags((prev) => (prev ?? []).map((f) => (f.key === updated.key ? updated : f)));
    setDrafts((prev) => ({
      ...prev,
      [updated.key]: {
        comingSoon: updated.comingSoon,
        bypassEmailsText: updated.bypassEmails.join("\n"),
        saving: false,
        error: null,
        saved: true,
      },
    }));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Flag className="w-5 h-5 text-primary" />
            Feature Flags
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5 max-w-2xl">
            Control which workspace features are presented as &ldquo;coming
            soon&rdquo; and which user emails are allowed to bypass the lock.
            Changes apply on the next page load for affected users.
          </p>
        </div>
      </div>

      {loadError && (
        <div className="rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-sm text-red-300 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">Could not load feature flags</div>
            <div className="text-xs opacity-80 mt-0.5">{loadError}</div>
          </div>
        </div>
      )}

      {loading && !flags && (
        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-8 flex items-center justify-center gap-3 text-sm text-primary">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading feature flags&hellip;
        </div>
      )}

      {flags && flags.length === 0 && !loadError && (
        <div className="rounded-2xl border border-border/60 bg-slate-950/60 p-8 text-center text-sm text-muted-foreground">
          No feature flags are registered yet.
        </div>
      )}

      {grouped.map(([category, items]) => (
        <section key={category} className="space-y-3">
          <h2 className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            {category}
          </h2>
          <div className="space-y-3">
            {items.map((flag) => {
              const draft = drafts[flag.key];
              if (!draft) return null;
              return (
                <div
                  key={flag.key}
                  className="rounded-2xl border border-border/70 bg-slate-950/70 p-5 space-y-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold flex items-center gap-2">
                        {flag.label}
                        {flag.comingSoon && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-500/10 text-amber-300 text-[10px] px-2 py-0.5">
                            <Lock className="w-2.5 h-2.5" />
                            Coming soon
                          </span>
                        )}
                      </div>
                      <code className="text-[11px] text-muted-foreground font-mono">
                        {flag.key}
                      </code>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={draft.comingSoon}
                        onChange={(e) =>
                          updateDraft(flag.key, { comingSoon: e.target.checked })
                        }
                        className="h-4 w-4 rounded border-border/60"
                      />
                      Lock as &ldquo;coming soon&rdquo;
                    </label>
                  </div>

                  <div>
                    <label className="text-[11px] uppercase tracking-wider text-muted-foreground block mb-1.5">
                      Bypass emails
                    </label>
                    <textarea
                      value={draft.bypassEmailsText}
                      onChange={(e) =>
                        updateDraft(flag.key, { bypassEmailsText: e.target.value })
                      }
                      placeholder="one-email@example.com per line"
                      rows={3}
                      className="w-full rounded-xl border border-border/60 bg-slate-900/60 p-2.5 text-sm font-mono text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/60"
                    />
                    <div className="text-[11px] text-muted-foreground mt-1">
                      Separate by newlines, commas, or spaces. Emails are
                      lower-cased on save.
                    </div>
                  </div>

                  {draft.error && (
                    <div className="text-xs text-red-300 flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5" />
                      {draft.error}
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[11px] text-muted-foreground">
                      Last updated {new Date(flag.updatedAt).toLocaleString()}
                    </div>
                    <div className="flex items-center gap-2">
                      {draft.saved && (
                        <span className="text-emerald-400 text-xs flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Saved
                        </span>
                      )}
                      <button
                        onClick={() => save(flag)}
                        disabled={draft.saving}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-all",
                          draft.saving
                            ? "border-border/40 text-muted-foreground cursor-not-allowed"
                            : "border-primary/50 bg-primary/10 text-primary hover:bg-primary/20",
                        )}
                      >
                        {draft.saving ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Save className="w-3.5 h-3.5" />
                        )}
                        Save changes
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
