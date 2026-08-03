"use client";

/**
 * The autopilot reflexes — KEY's autonomic nervous system, and the switch for it.
 *
 * The whole loop existed and could not be started. AgentTriggerService installs
 * an events.onAny(...) firehose and, for every event, queries agentTrigger for
 * ENABLED rules. DefaultTriggersService seeds 22 of them, deliberately disabled,
 * so that creating a business never starts KEY acting on production data.
 *
 * There was then no screen to enable one. `fetchAgentTriggers` had existed in
 * lib/client.ts with zero callers, so the planner, executor, BullMQ workers,
 * dispatcher and feedback loop were all live and permanently idle, waiting on
 * rows nobody could switch on.
 *
 * This is that switch. It is deliberately plain: enabling a reflex means KEY
 * will act without being asked, and that decision deserves to be legible rather
 * than buried in a settings accordion.
 */

import { useEffect, useState } from "react";
import { Loader2, Zap, ZapOff, AlertTriangle } from "lucide-react";
import { fetchAgentTriggers, updateAgentTrigger } from "@/lib/client";

interface Reflex {
  id: string;
  name: string;
  eventPattern: string;
  enabled: boolean;
  autoExecute: boolean;
  maxRiskTier: number;
  objective: string;
}

/**
 * Patterns with no emitter anywhere in the server.
 *
 * Kept visible rather than hidden, but marked: enabling one does nothing, and
 * discovering that by waiting is worse than being told.
 */
const NO_EMITTER = new Set(["store_order.abandoned", "content_request.approved"]);

export function ReflexPanel({ businessId }: { businessId: string }) {
  const [reflexes, setReflexes] = useState<Reflex[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Mounted flag rather than a useCallback the effect then invokes: the
    // latter reaches setState synchronously from the effect body as far as the
    // linter can tell, and it cannot see past the callback to the await.
    let mounted = true;

    void (async () => {
      const res = await fetchAgentTriggers(businessId);
      if (!mounted) return;
      if (res.error) setError(res.error);
      else setReflexes((res.data as Reflex[]) ?? []);
      setLoading(false);
    })();

    return () => {
      mounted = false;
    };
  }, [businessId]);

  const toggle = async (reflex: Reflex) => {
    setBusy(reflex.id);
    setError(null);

    // Optimistic, then reconciled — a toggle that appears to do nothing for a
    // second reads as broken.
    const next = !reflex.enabled;
    setReflexes((rs) => rs.map((r) => (r.id === reflex.id ? { ...r, enabled: next } : r)));

    const res = await updateAgentTrigger(businessId, reflex.id, { enabled: next });
    if (res.error) {
      setError(res.error);
      setReflexes((rs) => rs.map((r) => (r.id === reflex.id ? { ...r, enabled: !next } : r)));
    }
    setBusy(null);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading reflexes…
      </div>
    );
  }

  const active = reflexes.filter((r) => r.enabled).length;

  return (
    <section className="rounded-xl border bg-card">
      <header className="flex items-start justify-between gap-4 border-b p-4">
        <div>
          <h2 className="text-sm font-semibold">Autopilot reflexes</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Events KEY responds to without being asked. All start switched off.
          </p>
        </div>
        <span className="shrink-0 rounded-full border px-2.5 py-1 text-xs tabular-nums text-muted-foreground">
          {active} of {reflexes.length} active
        </span>
      </header>

      {error ? (
        <p className="flex items-center gap-2 border-b bg-destructive/5 px-4 py-2 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5" />
          {error}
        </p>
      ) : null}

      {reflexes.length === 0 ? (
        <p className="p-6 text-sm text-muted-foreground">
          No reflexes exist for this business yet. They are created when a business is set up —
          run the backfill script if this business predates that.
        </p>
      ) : (
        <ul className="divide-y">
          {reflexes.map((r) => {
            const dead = NO_EMITTER.has(r.eventPattern);
            return (
              <li key={r.id} className="flex items-start gap-3 p-4">
                <button
                  type="button"
                  onClick={() => void toggle(r)}
                  disabled={busy === r.id || dead}
                  aria-pressed={r.enabled}
                  aria-label={`${r.enabled ? "Disable" : "Enable"} ${r.name}`}
                  className={`mt-0.5 shrink-0 rounded-md border p-1.5 transition ${
                    r.enabled
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600"
                      : "text-muted-foreground hover:bg-muted"
                  } ${dead ? "cursor-not-allowed opacity-40" : ""}`}
                >
                  {busy === r.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : r.enabled ? (
                    <Zap className="h-4 w-4" />
                  ) : (
                    <ZapOff className="h-4 w-4" />
                  )}
                </button>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{r.name}</span>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                      {r.eventPattern}
                    </code>
                    {r.autoExecute ? (
                      <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-600">
                        acts without approval up to tier {r.maxRiskTier}
                      </span>
                    ) : null}
                    {dead ? (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                        nothing emits this event yet
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{r.objective}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
