"use client";

/**
 * OWNER-ALERTS-WEB (D-154): the owner's alerts for a new booking, a payment received and an "I've paid" claim, sent
 * by push to the owner's phone first, with an email as the fallback (OWNER-ALERTS-SERVER, OwnerAlertsListener).
 *
 * The listener reads Business.notificationPreferences: `owner_alert_<category>: false` turns that category off, and a
 * key that is absent is on (resolveOwnerAlertPreferences). They are read and saved through the route Settings >
 * Notifications already uses for customer emails, GET/PATCH /notifications/businesses/:id/customer-preferences
 * (settings read / write). A save counts only when the server answers the value it was sent; a refused or dropped
 * save puts the switch back and says so. Push on this device is turned on in My account (D-282), not here.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarCheck, CreditCard, HandCoins, Loader2, type LucideIcon } from "lucide-react";
import { apiGet, apiPatch } from "@/lib/api";

type AlertKey = "owner_alert_bookings" | "owner_alert_payments" | "owner_alert_claims";
type AlertState = Record<AlertKey, boolean>;

const ALERTS: { key: AlertKey; label: string; description: string; icon: LucideIcon }[] = [
  { key: "owner_alert_bookings", label: "New bookings", description: "When a customer books with you", icon: CalendarCheck },
  { key: "owner_alert_payments", label: "Payments received", description: "When an invoice or order is paid", icon: CreditCard },
  { key: "owner_alert_claims", label: '"I\'ve paid" claims', description: "When a customer says they paid by bank transfer, to confirm", icon: HandCoins },
];

const prefsPath = (businessId: string) => `/notifications/businesses/${encodeURIComponent(businessId)}/customer-preferences`;

function readAlerts(prefs: Record<string, unknown>): AlertState {
  return {
    owner_alert_bookings: prefs.owner_alert_bookings !== false,
    owner_alert_payments: prefs.owner_alert_payments !== false,
    owner_alert_claims: prefs.owner_alert_claims !== false,
  };
}

export function OwnerAlertSettings({ businessId }: { businessId: string | null }) {
  const [alerts, setAlerts] = useState<AlertState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState<AlertKey | null>(null);
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
      if (!businessId) {
        setAlerts(null);
        setLoadError("Your alert settings could not be loaded: no business is selected.");
        return;
      }
      setLoadError(null);
      const { data, error } = await apiGet<Record<string, unknown>>(prefsPath(businessId));
      if (!current) return;
      if (error || !data || typeof data !== "object") {
        setAlerts(null);
        setLoadError(`Your alert settings could not be loaded (${error || "no answer"}).`);
        return;
      }
      setAlerts(readAlerts(data));
    })();
    return () => {
      current = false;
    };
  }, [businessId, reads]);

  const toggle = useCallback(
    async (key: AlertKey) => {
      if (!businessId || !alerts || saving) return;
      const next = !alerts[key];
      const label = ALERTS.find((a) => a.key === key)?.label ?? key;
      setSaving(key);
      setSaveError(null);
      setAlerts({ ...alerts, [key]: next });
      const { data, error } = await apiPatch<Record<string, unknown>>(prefsPath(businessId), { [key]: next });
      if (!live.current) return;
      const kept = !error && data && typeof data === "object" && (data as Record<string, unknown>)[key] === next;
      if (!kept) {
        setAlerts((prev) => (prev ? { ...prev, [key]: !next } : prev));
        setSaveError(`${label}: your change was not saved${error ? ` (${error})` : ""}. Try again.`);
      }
      setSaving(null);
    },
    [businessId, alerts, saving],
  );

  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold">Alerts to you</h3>
        <p className="kf-text-caption text-muted-foreground">
          A push to your phone, or an email if push is not on.
        </p>
      </div>

      {loadError && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl border border-border/40">
          <p className="kf-text-caption">{loadError}</p>
          <button
            type="button"
            onClick={() => setReads((n) => n + 1)}
            className="min-h-11 px-3 rounded-lg text-sm font-medium border border-border/60"
          >
            Retry
          </button>
        </div>
      )}

      {!loadError && !alerts && (
        <p className="kf-text-caption text-muted-foreground" role="status">
          Loading your alert settings…
        </p>
      )}

      {saveError && (
        <p role="alert" className="kf-text-caption" style={{ color: "hsl(var(--kf-error))" }}>
          {saveError}
        </p>
      )}

      {alerts &&
        ALERTS.map(({ key, label, description, icon: Icon }) => {
          const on = alerts[key];
          return (
            <div
              key={key}
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
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={`Alerts for ${label}`}
                onClick={() => toggle(key)}
                disabled={saving !== null}
                className="relative w-10 h-5.5 rounded-full transition-colors duration-200 flex-shrink-0 disabled:opacity-70"
                style={{ background: on ? "hsl(var(--kf-success))" : "hsl(var(--muted))" }}
              >
                <span
                  className="absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white shadow transition-transform duration-200"
                  style={{ transform: on ? "translateX(19px)" : "translateX(2px)" }}
                />
                {saving === key && (
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
