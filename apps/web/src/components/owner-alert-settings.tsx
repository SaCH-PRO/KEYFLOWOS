"use client";

/**
 * OWNER-ALERTS-WEB (D-154): the business owner's alerts for a new booking, a payment received and an "I've paid"
 * claim, sent by push to the owner's phone first, with an email as the fallback (OWNER-ALERTS-SERVER,
 * OwnerAlertsListener, which reads Business.notificationPreferences: `owner_alert_<category>: false` turns that
 * category off, absent is on).
 *
 * Repair round 1:
 * - SEC-OAW-1 (orchestrator ruling: fail closed until the owner rules): only an owner of the business changes them,
 *   and a change applies to every owner. GET /notifications/businesses/:id/owner-alerts answers the three values and
 *   whether this member may change them (canChange); everyone else sees them read-only. Saves go through PATCH
 *   .../customer-preferences, which refuses a non-owner (403 OWNER_ALERTS_OWNER_ONLY). The words say "the business
 *   owner", never "your": the reader may not be the owner.
 * - COR-OAW-1 / SEC-OAW-3: FAILURE-KIT. A read is judged by readState: no access is NoAccessState (no Retry; nothing
 *   to retry), a failed load says so with Retry. A refused save is said in the kit's words (refusalMessage: the
 *   server's own words), with no "Try again" on a refusal.
 *
 * A save counts only when the server answers the value it was sent; otherwise the switch goes back and it says so.
 * Push on this device is turned on in My account (D-282), not here.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CalendarCheck, CreditCard, HandCoins, Loader2, type LucideIcon } from "lucide-react";
import { apiGet, apiPatch } from "@/lib/api";
import { readState, refusalMessage, type ReadState } from "@/lib/failure-kit";
import { NoAccessState } from "@/components/ui/no-access-state";

type Category = "bookings" | "payments" | "claims";
type Alerts = Record<Category, boolean>;
interface OwnerAlertsAnswer extends Alerts {
  canChange: boolean;
}

const ALERTS: { category: Category; key: string; label: string; description: string; icon: LucideIcon }[] = [
  { category: "bookings", key: "owner_alert_bookings", label: "New bookings", description: "When a customer books", icon: CalendarCheck },
  { category: "payments", key: "owner_alert_payments", label: "Payments received", description: "When an invoice or order is paid", icon: CreditCard },
  { category: "claims", key: "owner_alert_claims", label: '"I\'ve paid" claims', description: "When a customer says they paid by bank transfer, to confirm", icon: HandCoins },
];

const WHAT = "the business owner's alerts";
const base = (businessId: string) => `/notifications/businesses/${encodeURIComponent(businessId)}`;

export function OwnerAlertSettings({ businessId }: { businessId: string | null }) {
  const [alerts, setAlerts] = useState<Alerts | null>(null);
  const [canChange, setCanChange] = useState(false);
  const [read, setRead] = useState<ReadState>({ kind: "ok" });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState<Category | null>(null);
  const [reads, setReads] = useState(0);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  useEffect(() => {
    let current = true;
    void (async () => {
      setAlerts(null);
      if (!businessId) {
        setRead({ kind: "failed", message: `Couldn't load ${WHAT}: no business is selected.` });
        return;
      }
      setRead({ kind: "ok" });
      const res = await apiGet<OwnerAlertsAnswer>(`${base(businessId)}/owner-alerts`);
      if (!current) return;
      const state = readState(res, { what: WHAT });
      const data = res.data;
      if (state.kind !== "ok" || !data || typeof data !== "object") {
        setRead(state.kind === "ok" ? { kind: "failed", message: `Couldn't load ${WHAT}.` } : state);
        return;
      }
      setCanChange(data.canChange === true);
      setAlerts({ bookings: data.bookings !== false, payments: data.payments !== false, claims: data.claims !== false });
    })();
    return () => {
      current = false;
    };
  }, [businessId, reads]);

  const toggle = useCallback(
    async (category: Category) => {
      if (!businessId || !alerts || !canChange || saving) return;
      const { key, label } = ALERTS.find((a) => a.category === category)!;
      const next = !alerts[category];
      setSaving(category);
      setSaveError(null);
      setAlerts({ ...alerts, [category]: next });
      const res = await apiPatch<Record<string, unknown>>(`${base(businessId)}/customer-preferences`, { [key]: next });
      if (!live.current) return;
      const refused = refusalMessage(res, { what: `change ${WHAT}` });
      const kept = !refused && !!res.data && typeof res.data === "object" && res.data[key] === next;
      if (!kept) {
        setAlerts((prev) => (prev ? { ...prev, [category]: !next } : prev));
        setSaveError(`${label}: ${refused ?? "the change was not saved (the server did not keep it)."}`);
      }
      setSaving(null);
    },
    [businessId, alerts, canChange, saving],
  );

  return (
    <div className="space-y-2" data-testid="owner-alert-settings">
      <div>
        <h3 className="text-sm font-semibold">The business owner&apos;s alerts</h3>
        <p className="kf-text-caption text-muted-foreground">
          A push to the owner&apos;s phone first, or an email if push is not on. A change here applies to every owner of
          this business.
        </p>
      </div>

      {read.kind === "no-access" && <NoAccessState message={read.message} variant="compact" />}

      {read.kind === "failed" && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-border/40 p-3">
          <AlertTriangle className="h-4 w-4 shrink-0" style={{ color: "hsl(var(--kf-error))" }} />
          <p className="kf-text-caption min-w-0 flex-1 break-words">{read.message}</p>
          <button
            type="button"
            onClick={() => setReads((n) => n + 1)}
            className="min-h-11 px-3 rounded-lg text-sm font-medium border border-border/60"
          >
            Retry
          </button>
        </div>
      )}

      {read.kind === "ok" && !alerts && (
        <p className="kf-text-caption text-muted-foreground" role="status">
          Loading {WHAT}…
        </p>
      )}

      {alerts && !canChange && <p className="kf-text-caption">Only the business owner can change these.</p>}

      {saveError && (
        <p role="alert" className="kf-text-caption" style={{ color: "hsl(var(--kf-error))" }}>
          {saveError}
        </p>
      )}

      {alerts &&
        ALERTS.map(({ category, label, description, icon: Icon }) => {
          const on = alerts[category];
          return (
            <div
              key={category}
              className="flex items-center justify-between gap-3 p-4 rounded-xl border border-border/40 bg-card/50"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className="h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: on ? "hsl(var(--kf-accent2) / 0.1)" : "hsl(var(--muted) / 0.3)" }}
                >
                  <Icon
                    className="w-4 h-4"
                    style={{ color: on ? "hsl(var(--kf-accent2))" : "hsl(var(--muted-foreground))" }}
                  />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{label}</p>
                  <p className="kf-text-caption text-muted-foreground">{description}</p>
                </div>
              </div>
              {/* h-6 w-11 / h-5 w-5: Tailwind 3 has no h-5.5 or h-4.5 (they render 0px tall in a browser). */}
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={`Alerts for ${label}`}
                onClick={() => toggle(category)}
                disabled={!canChange || saving !== null}
                className="relative h-6 w-11 rounded-full transition-colors duration-200 flex-shrink-0 disabled:opacity-70"
                style={{ background: on ? "hsl(var(--kf-success))" : "hsl(var(--muted))" }}
              >
                <span
                  className="absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200"
                  style={{ transform: on ? "translateX(22px)" : "translateX(2px)" }}
                />
                {saving === category && (
                  <Loader2
                    className="absolute top-1 right-1 w-3.5 h-3.5 animate-spin"
                    style={{ color: "hsl(var(--background))" }}
                  />
                )}
              </button>
            </div>
          );
        })}
    </div>
  );
}
