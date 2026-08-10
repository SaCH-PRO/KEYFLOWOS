"use client";

import { useEffect, useState } from "react";
import { ModuleShell } from "@/components/ui/module-shell";
import { BarChart3, Target, Activity, ShieldCheck } from "lucide-react";
import { apiGet } from "@/lib/api";
import { useControlTowerData } from "@/app/app/control-tower/components/use-control-tower-data";

const intelligenceTabs = [
  { label: "Reports", href: "/app/intelligence/reports", icon: BarChart3 },
  { label: "Goals", href: "/app/intelligence/goals", icon: Target },
  { label: "Operations", href: "/app/intelligence/ops", icon: Activity },
  { label: "Compliance", href: "/app/intelligence/compliance", icon: ShieldCheck },
];

/**
 * Evidence and the decision audit trail.
 *
 * Both halves come from endpoints that already existed:
 *   GET /businesses/:id/evidence            -> { items, total, offset, limit }
 *   GET /api/v1/cortex/audit/decisions      -> { total, blocked, recent }
 *
 * Every number rendered here is read from one of those. Nothing on this page is
 * a constant, and when a call fails it says so rather than showing a zero — a
 * compliance screen that reports "0 blocked decisions" because a request 500'd
 * is worse than one that reports nothing.
 */
type Evidence = {
  id: string;
  evidenceType?: string | null;
  description?: string | null;
  verifiedAt?: string | null;
  submittedAt?: string | null;
  linkedType?: string | null;
};

type Verdict = {
  id: string;
  action?: string | null;
  allowed?: boolean | null;
  reason?: string | null;
  createdAt?: string | null;
};

export default function IntelligenceCompliancePage() {
  const { businessId } = useControlTowerData();

  const [evidence, setEvidence] = useState<{ items: Evidence[]; total: number } | null>(null);
  const [decisions, setDecisions] = useState<{ total: number; blocked: number; recent: Verdict[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      const [ev, dec] = await Promise.all([
        apiGet<{ items: Evidence[]; total: number }>(`/businesses/${businessId}/evidence?limit=25`),
        apiGet<{ total: number; blocked: number; recent: Verdict[] }>(
          `/api/v1/cortex/audit/decisions?businessId=${businessId}`,
        ),
      ]);
      if (cancelled) return;

      // Reported separately from the data. A failed call must not render as an
      // empty list, because "no evidence on file" and "we could not ask" are
      // different answers and only one of them is a compliance finding.
      if (ev.error && dec.error) setError("Could not load evidence or the decision audit trail.");
      else if (ev.error) setError("Could not load evidence.");
      else if (dec.error) setError("Could not load the decision audit trail.");

      if (ev.data) setEvidence(ev.data);
      if (dec.data) setDecisions(dec.data);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [businessId]);

  const verified = evidence?.items.filter((e) => e.verifiedAt).length ?? 0;
  const unverified = (evidence?.items.length ?? 0) - verified;

  return (
    <ModuleShell
      icon={ShieldCheck}
      title="Compliance"
      subtitle="Evidence, audit trail & verification"
      tabs={intelligenceTabs}
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-amber-300">
            {error}
          </div>
        )}

        {loading && !evidence && !decisions && (
          <div className="rounded-2xl border border-border/40 bg-slate-950/40 px-4 py-8 text-center text-xs text-muted-foreground">
            Loading compliance data…
          </div>
        )}

        {(evidence || decisions) && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Evidence on file" value={evidence ? String(evidence.total) : "—"} />
            <Stat label="Verified (recent)" value={evidence ? String(verified) : "—"} />
            <Stat
              label="Awaiting verification"
              value={evidence ? String(unverified) : "—"}
              tone={unverified > 0 ? "warn" : undefined}
            />
            <Stat
              label="Decisions blocked"
              value={decisions ? `${decisions.blocked} / ${decisions.total}` : "—"}
              tone={decisions && decisions.blocked > 0 ? "warn" : undefined}
            />
          </div>
        )}

        {evidence && (
          <Panel title="Evidence" empty={evidence.items.length === 0 ? "No evidence has been submitted yet." : null}>
            {evidence.items.slice(0, 10).map((e) => (
              <Row
                key={e.id}
                primary={e.description || e.evidenceType || e.id}
                secondary={[e.evidenceType, e.linkedType].filter(Boolean).join(" · ")}
                badge={e.verifiedAt ? "verified" : "unverified"}
                badgeTone={e.verifiedAt ? "ok" : "warn"}
                when={e.submittedAt}
              />
            ))}
          </Panel>
        )}

        {decisions && (
          <Panel
            title="KEY decision audit"
            empty={decisions.recent.length === 0 ? "KEY has not recorded an autonomy decision yet." : null}
          >
            {decisions.recent.slice(0, 10).map((v) => (
              <Row
                key={v.id}
                primary={v.action || v.id}
                secondary={v.reason || ""}
                badge={v.allowed ? "allowed" : "blocked"}
                badgeTone={v.allowed ? "ok" : "warn"}
                when={v.createdAt}
              />
            ))}
          </Panel>
        )}
      </div>
    </ModuleShell>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className="rounded-xl border border-border/40 bg-slate-950/40 px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${tone === "warn" ? "text-amber-300" : "text-foreground"}`}>
        {value}
      </div>
    </div>
  );
}

function Panel({ title, empty, children }: { title: string; empty: string | null; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border/40 bg-slate-950/40">
      <div className="border-b border-border/40 px-4 py-2.5 text-xs font-semibold text-foreground">{title}</div>
      {empty ? (
        <div className="px-4 py-6 text-center text-xs text-muted-foreground">{empty}</div>
      ) : (
        <div className="divide-y divide-border/30">{children}</div>
      )}
    </div>
  );
}

function Row({
  primary,
  secondary,
  badge,
  badgeTone,
  when,
}: {
  primary: string;
  secondary?: string;
  badge: string;
  badgeTone: "ok" | "warn";
  when?: string | null;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs text-foreground">{primary}</div>
        {secondary ? <div className="truncate text-[11px] text-muted-foreground">{secondary}</div> : null}
      </div>
      {when ? (
        <div className="shrink-0 text-[11px] text-muted-foreground">
          {new Date(when).toLocaleDateString()}
        </div>
      ) : null}
      <span
        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${
          badgeTone === "ok"
            ? "bg-emerald-500/10 text-emerald-300"
            : "bg-amber-500/10 text-amber-300"
        }`}
      >
        {badge}
      </span>
    </div>
  );
}
