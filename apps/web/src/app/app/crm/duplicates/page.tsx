"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, Copy, Loader2, Merge, RefreshCw, Undo2 } from "lucide-react";
import Link from "next/link";
import { fetchDuplicateContacts, fetchMergePreview, mergeContacts, revertMerge } from "@/lib/client";
import { MergeContactsModal } from "@/components/contacts/merge-contacts-modal";
import { ensureWorkspace, getStoredBusinessId } from "@/lib/workspace";

type DuplicateContact = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  email?: string | null;
  phone?: string | null;
  companyName?: string | null;
  status?: string;
};

type Pair = {
  primaryId: string;
  duplicateId: string;
  rule: string;
  confidence: number;
  reason: string;
  primary: DuplicateContact;
  duplicate: DuplicateContact;
};

const RULE_BADGE: Record<string, { label: string; cls: string }> = {
  exact_email: { label: "Exact email", cls: "bg-red-500/15 text-red-500" },
  normalized_phone: { label: "Same phone", cls: "bg-orange-500/15 text-orange-500" },
  name_phone_partial: { label: "Name + phone", cls: "bg-amber-500/15 text-amber-500" },
  company_email_domain: { label: "Company + domain", cls: "bg-yellow-500/15 text-yellow-500" },
  display_name_similarity: { label: "Similar name", cls: "bg-blue-500/15 text-blue-500" },
};

export default function DuplicatesPage() {
  const search = useSearchParams();
  const importId = search.get("importId") || undefined;
  const [businessId, setBusinessId] = useState<string | null>(() => getStoredBusinessId());
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const PAGE_SIZE = 25;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const [openPair, setOpenPair] = useState<Pair | null>(null);

  const load = useCallback(async (reset = false) => {
    if (!businessId) return;
    setLoading(true);
    setError(null);
    try {
      const nextOffset = reset ? 0 : offset;
      const { data } = await fetchDuplicateContacts(businessId, { importId, limit: PAGE_SIZE, minConfidence: 0.5, offset: nextOffset });
      const incoming = (data?.pairs as Pair[]) ?? [];
      setPairs(reset ? incoming : [...pairs, ...incoming]);
      setTotal(data?.total ?? incoming.length);
      if (reset) setOffset(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load duplicates");
    } finally {
      setLoading(false);
    }
  }, [businessId, importId, offset, pairs]);

  const loadMore = useCallback(() => {
    setOffset((o) => o + PAGE_SIZE);
  }, []);

  useEffect(() => {
    if (businessId) return;
    let cancelled = false;
    ensureWorkspace().then((id) => { if (!cancelled && id) setBusinessId(id); }).catch(() => {});
    return () => { cancelled = true; };
  }, [businessId]);

  useEffect(() => {
    if (!businessId) return;
    setPairs([]);
    setOffset(0);
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, importId]);

  useEffect(() => {
    if (!businessId || offset === 0) return;
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset]);

  const handleMerge = async (keepId: string, dupeId: string, fieldOverrides: Record<string, unknown>) => {
    if (!businessId) return;
    setMerging(true);
    try {
      const { data, error: err } = await mergeContacts({ businessId, contactId: keepId, duplicateId: dupeId, fieldOverrides });
      if (err || !data) throw new Error(err || "Merge failed");
      const mergeId = (data as { mergeId?: string }).mergeId;
      const revertableUntil = (data as { revertableUntil?: string }).revertableUntil;
      setOpenPair(null);
      await load(true);
      const expiresMs = revertableUntil ? new Date(revertableUntil).getTime() - Date.now() : 24 * 60 * 60 * 1000;
      toast.success("Contacts merged", {
        description: revertableUntil ? `You can undo this merge for the next 24 hours.` : undefined,
        duration: Math.min(15000, Math.max(8000, expiresMs)),
        action: mergeId
          ? {
              label: "Undo",
              onClick: async () => {
                try {
                  const { data: rev, error: revErr } = await revertMerge({ businessId, mergeId });
                  if (revErr || !rev) throw new Error(revErr || "Revert failed");
                  toast.success("Merge reverted");
                  await load(true);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Failed to revert");
                }
              },
            }
          : undefined,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to merge contacts");
    } finally {
      setMerging(false);
    }
  };

  const headerCount = useMemo(() => total || pairs.length, [pairs, total]);
  const hasMore = pairs.length < total;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/app/network/contacts" className="p-2 rounded-lg hover:bg-muted/40" aria-label="Back to CRM">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <Copy className="w-5 h-5 text-amber-500" /> Duplicates
              {importId && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-500">scoped to import</span>
              )}
            </h1>
            <p className="text-xs text-muted-foreground">
              {headerCount} candidate{headerCount !== 1 ? "s" : ""} sorted by confidence
            </p>
          </div>
        </div>
        <button onClick={() => load(true)} className="kf-btn-secondary text-xs flex items-center gap-1.5" aria-label="Refresh">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="kf-card p-4 border border-[hsl(var(--kf-error))]/30 bg-[hsl(var(--kf-error))]/5 flex items-center gap-3">
          <AlertTriangle className="w-4 h-4 text-[hsl(var(--kf-error))]" />
          <span className="text-sm text-muted-foreground flex-1">{error}</span>
          <button onClick={() => load(true)} className="kf-btn-secondary text-xs">Retry</button>
        </div>
      )}

      {loading && pairs.length === 0 && (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Scanning your contacts…
        </div>
      )}

      {!loading && pairs.length === 0 && !error && (
        <div className="kf-card p-8 text-center text-sm text-muted-foreground">
          No likely duplicates found. Your CRM is squeaky clean.
        </div>
      )}

      <div className="space-y-3">
        {pairs.map((p) => {
          const badge = RULE_BADGE[p.rule] ?? { label: p.rule, cls: "bg-muted text-muted-foreground" };
          return (
            <div key={`${p.primaryId}::${p.duplicateId}`} className="kf-card p-4 flex items-start gap-4">
              <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-3">
                {[p.primary, p.duplicate].map((c, idx) => (
                  <div key={c.id} className={`p-3 rounded-lg border ${idx === 0 ? "border-emerald-500/30 bg-emerald-500/5" : "border-border/40"}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${idx === 0 ? "bg-emerald-500/15 text-emerald-500" : "bg-muted text-muted-foreground"}`}>
                        {idx === 0 ? "Keep (older)" : "Merge in"}
                      </span>
                      {c.status && <span className="text-[10px] text-muted-foreground">{c.status}</span>}
                    </div>
                    <div className="text-sm font-medium truncate">
                      {c.displayName || `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || c.email || "Unknown"}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {[c.email, c.phone].filter(Boolean).join(" · ")}
                    </div>
                    {c.companyName && <div className="text-xs text-muted-foreground truncate">{c.companyName}</div>}
                  </div>
                ))}
              </div>
              <div className="flex flex-col items-end gap-2 min-w-[160px]">
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
                <span className="text-xs text-muted-foreground">{Math.round(p.confidence * 100)}% confidence</span>
                <button
                  onClick={() => setOpenPair(p)}
                  disabled={merging}
                  className="text-xs px-3 py-2 rounded-lg bg-[hsl(var(--kf-accent2))]/10 hover:bg-[hsl(var(--kf-accent2))]/20 transition-colors flex items-center gap-1.5 disabled:opacity-50 text-[hsl(var(--kf-accent2))]"
                >
                  {merging ? <Loader2 className="w-3 h-3 animate-spin" /> : <Merge className="w-3 h-3" />}
                  Review &amp; merge
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {hasMore && (
        <div className="flex justify-center pt-2">
          <button
            onClick={loadMore}
            disabled={loading}
            className="kf-btn-secondary text-xs flex items-center gap-1.5 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            Load more ({pairs.length} of {total})
          </button>
        </div>
      )}

      {openPair && (
        <MergeContactsModal
          open={!!openPair}
          left={openPair.primary}
          right={openPair.duplicate}
          onClose={() => setOpenPair(null)}
          onMerge={handleMerge}
          loadPreview={async (primaryId, duplicateId) => {
            if (!businessId) return null;
            const { data } = await fetchMergePreview({ businessId, primaryId, duplicateId });
            if (!data) return null;
            return {
              fields: data.fields ?? [],
              customFields: data.customFields ?? [],
              mergedCustom: data.mergedCustom ?? {},
              relatedRecords: data.relatedRecords,
            };
          }}
        />
      )}

      <p className="text-[11px] text-muted-foreground text-center pt-2 flex items-center justify-center gap-1">
        <Undo2 className="w-3 h-3" /> Every merge can be undone for 24 hours from the success toast.
      </p>
    </div>
  );
}
