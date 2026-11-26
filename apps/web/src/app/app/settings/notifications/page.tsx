"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import {
  Bell,
  Mail,
  FileText,
  CreditCard,
  RefreshCw,
  XCircle,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import Link from "next/link";
import { apiGet, apiPatch } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";
import { InfoBadge } from "@/components/ui/info-badge";
import { NoAccessState } from "@/components/ui/no-access-state";
import { readState, type ReadState } from "@/lib/failure-kit";
import { toast } from "sonner";
// OWNER-ALERTS-WEB (D-154): the "Owner alerts" tab, its own components.
import { InstallAppStep } from "@/components/install-app-step";
import { OwnerAlertSettings } from "@/components/owner-alert-settings";

interface NotificationPreferences {
  booking_confirmed: boolean;
  booking_reminder: boolean;
  booking_rescheduled: boolean;
  booking_cancelled: boolean;
  invoice_sent: boolean;
  payment_receipt: boolean;
}

interface NotificationLogEntry {
  id: string;
  type: string;
  recipientEmail: string;
  recipientName?: string;
  subject: string;
  status: string;
  sentAt?: string;
  createdAt: string;
}

const NOTIFICATION_TYPES: {
  key: keyof NotificationPreferences;
  label: string;
  description: string;
  icon: typeof Bell;
}[] = [
  {
    key: "booking_confirmed",
    label: "Booking Confirmation",
    description: "When a booking is confirmed, email the customer with details",
    icon: CheckCircle2,
  },
  {
    key: "booking_reminder",
    label: "Appointment Reminder",
    description: "24-hour reminder before scheduled appointments",
    icon: Clock,
  },
  {
    key: "booking_rescheduled",
    label: "Booking Rescheduled",
    description: "Notify customers when their appointment time changes",
    icon: RefreshCw,
  },
  {
    key: "booking_cancelled",
    label: "Booking Cancelled",
    description: "Notify customers when their appointment is cancelled",
    icon: XCircle,
  },
  {
    key: "invoice_sent",
    label: "Invoice Sent",
    description: "Send invoice details to the customer when an invoice is issued",
    icon: FileText,
  },
  {
    key: "payment_receipt",
    label: "Payment Receipt",
    description: "Confirm payment received with a receipt email",
    icon: CreditCard,
  },
];

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  SENT: { bg: "hsl(var(--kf-success) / 0.1)", text: "hsl(var(--kf-success))", label: "Sent" },
  FAILED: { bg: "hsl(var(--kf-error) / 0.1)", text: "hsl(var(--kf-error))", label: "Failed" },
  QUEUED: { bg: "hsl(var(--kf-warning) / 0.1)", text: "hsl(var(--kf-warning))", label: "Queued" },
  DRAINED: { bg: "hsl(var(--kf-success) / 0.1)", text: "hsl(var(--kf-success))", label: "Sent (Queued)" },
  EXPIRED: { bg: "hsl(var(--kf-error) / 0.1)", text: "hsl(var(--kf-error))", label: "Expired" },
};

const TYPE_LABELS: Record<string, string> = {
  booking_confirmed: "Booking Confirmed",
  booking_reminder: "Reminder",
  booking_rescheduled: "Rescheduled",
  booking_cancelled: "Cancelled",
  invoice_sent: "Invoice",
  payment_receipt: "Receipt",
};

/** A read that did not give the tab its data: no access (FAILURE-KIT's NoAccessState), or a failed load with Retry. */
function ReadProblem({ state, onRetry }: { state: ReadState; onRetry: () => void }) {
  if (state.kind === "ok") return null;
  if (state.kind === "no-access") return <NoAccessState message={state.message} />;
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
      <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
      <span className="min-w-0 flex-1 break-words">{state.message}</span>
      <button
        type="button"
        onClick={onRetry}
        className="min-h-9 rounded-md border px-3 py-1.5 font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Retry
      </button>
    </div>
  );
}

export default function NotificationsSettingsPage() {
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [log, setLog] = useState<NotificationLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  // The switches whose PATCH is in flight: each answer decides only its own switch (and clears only its own spinner).
  const [saving, setSaving] = useState<ReadonlySet<keyof NotificationPreferences>>(() => new Set());
  const pending = useRef(new Set<keyof NotificationPreferences>());
  const [activeTab, setActiveTab] = useState<"preferences" | "log" | "alerts">("preferences");
  // FU-NOTIFICATIONS-PAGE-REFUSED (D-283): each read judged by FAILURE-KIT's readState, so a settings-none member's
  // refused read is said as no access (never a blank tab or "No customer notifications sent yet"), and any other
  // failure (a 5xx, a network error, BusinessGuard's 403) as a failed load.
  const [prefsRead, setPrefsRead] = useState<ReadState>({ kind: "ok" });
  const [logRead, setLogRead] = useState<ReadState>({ kind: "ok" });
  // Counts the loads started, so a toggle's failure knows whether a load (a Retry) has read the server since its click.
  const loadGen = useRef(0);

  const loadData = useCallback(async () => {
    const businessId = getStoredBusinessId();
    if (!businessId) { setLoading(false); return; }
    loadGen.current += 1;
    setLoading(true);
    const [prefsRes, logRes] = await Promise.all([
      apiGet<NotificationPreferences>(`/notifications/businesses/${businessId}/customer-preferences`),
      apiGet<NotificationLogEntry[]>(`/notifications/businesses/${businessId}/customer-log?limit=100`),
    ]);
    const prefsState = readState(prefsRes, { what: "the customer notification settings" });
    const logState = readState(logRes, { what: "the customer notification log" });
    setPrefsRead(prefsState);
    setLogRead(logState);
    setPreferences(prefsState.kind === "ok" ? prefsRes.data : null);
    setLog(logState.kind === "ok" && Array.isArray(logRes.data) ? logRes.data : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs external or derived state into local component state
    loadData();
  }, [loadData]);

  const togglePreference = async (key: keyof NotificationPreferences) => {
    if (!preferences) return;
    const before = preferences[key];
    const newValue = !before;
    const loadAtClick = loadGen.current;
    const businessId = getStoredBusinessId();
    if (!businessId) return;
    pending.current.add(key);
    setSaving(new Set(pending.current));
    setPreferences((current) => (current ? { ...current, [key]: newValue } : current));
    const path = `/notifications/businesses/${businessId}/customer-preferences`;
    const res = await apiPatch<NotificationPreferences>(path, { [key]: newValue });
    if (res.error) {
      // The answer comes from the server (a Retry may have reloaded the page since the click): re-read the preferences
      // and take this switch from them, as a PATCH answer is taken: every other switch is decided by its own answer or
      // by a load, so a re-read read before another switch's commit cannot flip it. A refused re-read (access revoked)
      // says no access; only when the re-read fails otherwise, and no load has read the server since the click, is this
      // switch put back.
      const fresh = await apiGet<NotificationPreferences>(path);
      const freshState = readState(fresh, { what: "the customer notification settings" });
      const serverValue = fresh.data?.[key];
      if (freshState.kind === "ok" && typeof serverValue === "boolean") {
        setPreferences((current) => (current ? { ...current, [key]: serverValue } : current));
      } else if (freshState.kind === "no-access") {
        // Both reads need settings read: the log goes too.
        setPrefsRead(freshState);
        setPreferences(null);
        setLogRead(readState(fresh, { what: "the customer notification log" }));
        setLog([]);
      } else if (loadGen.current === loadAtClick) {
        setPreferences((current) => (current ? { ...current, [key]: before } : current));
      }
      toast.error("Failed to update notification preference");
    } else {
      // The PATCH answers the whole preferences, but read before any other PATCH still in flight was decided: take
      // only this switch from it.
      const answered = res.data?.[key];
      if (typeof answered === "boolean") {
        setPreferences((current) => (current ? { ...current, [key]: answered } : current));
      }
      toast.success("Notification preference updated");
    }
    pending.current.delete(key);
    setSaving(new Set(pending.current));
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="flex items-center gap-3">
          <div className="h-5 w-36 bg-muted/40 rounded-lg" />
        </div>
        <div className="flex gap-1 p-1 rounded-xl bg-muted/30 border border-border/40">
          <div className="h-9 w-28 bg-muted/30 rounded-lg" />
          <div className="h-9 w-28 bg-muted/20 rounded-lg" />
        </div>
        <div className="kf-card p-6 space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center justify-between">
              <div className="space-y-1">
                <div className="h-4 w-32 bg-muted/30 rounded" />
                <div className="h-3 w-48 bg-muted/20 rounded" />
              </div>
              <div className="h-6 w-10 bg-muted/30 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div
          className="h-9 w-9 rounded-xl flex items-center justify-center"
          style={{ background: "hsl(var(--kf-accent1) / 0.1)" }}
        >
          <Bell className="w-4.5 h-4.5" style={{ color: "hsl(var(--kf-accent1))" }} />
        </div>
        <div>
          <h2 className="text-lg font-semibold inline-flex items-center gap-2">Customer Notifications <InfoBadge title="How Notifications Work" body="Transactional emails are sent via your connected Gmail account. Toggle each type on/off. Customers receive branded emails with your business info." side="right" iconSize={13} /></h2>
          <p className="kf-text-caption text-muted-foreground">
            Automated emails sent to your customers via Gmail
          </p>
        </div>
      </div>

      <div className="flex gap-1 p-1 rounded-xl bg-muted/30 border border-border/40 w-fit">
        {(["preferences", "log", "alerts"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab
                ? "bg-background text-foreground shadow-sm border border-border/60"
                : "text-muted-foreground hover:text-foreground/80"
            }`}
          >
            {tab === "preferences" ? "Preferences" : tab === "alerts" ? "Owner alerts" : logRead.kind === "ok" ? `Log (${log.length})` : "Log"}
          </button>
        ))}
      </div>

      {/* FU-PUSH-OPTIN-MY-ACCOUNT (D-282): push on the member's own device is every member's, on My account. This page
          (settings readers only, D-276) keeps the business's customer emails; one control for one device's push. */}
      <p className="kf-text-caption text-muted-foreground">
        Push notifications for your own device are in{" "}
        <Link href="/app/settings/profile" className="font-medium text-foreground underline underline-offset-2">
          My account
        </Link>
        .
      </p>

      {activeTab === "preferences" && <ReadProblem state={prefsRead} onRetry={loadData} />}
      {activeTab === "log" && <ReadProblem state={logRead} onRetry={loadData} />}

      {activeTab === "preferences" && prefsRead.kind === "ok" && preferences && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-3"
        >
          <div
            className="flex items-start gap-3 p-4 rounded-xl border"
            style={{
              background: "hsl(var(--kf-info) / 0.05)",
              borderColor: "hsl(var(--kf-info) / 0.15)",
            }}
          >
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: "hsl(var(--kf-info))" }} />
            <p className="kf-text-caption" style={{ color: "hsl(var(--kf-info))" }}>
              Customer notifications are sent via your connected Gmail account.
              Connect Gmail in Settings &rarr; Connections to enable sending. Notifications
              will be queued if Gmail is not connected.
            </p>
          </div>

          <div className="space-y-2">
            {NOTIFICATION_TYPES.map((type) => {
              const Icon = type.icon;
              const enabled = preferences[type.key];
              return (
                <div
                  key={type.key}
                  className="flex items-center justify-between p-4 rounded-xl border border-border/40 bg-card/50 transition-colors hover:bg-card/80"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="h-8 w-8 rounded-lg flex items-center justify-center"
                      style={{
                        background: enabled
                          ? "hsl(var(--kf-accent2) / 0.1)"
                          : "hsl(var(--muted) / 0.3)",
                      }}
                    >
                      <Icon
                        className="w-4 h-4"
                        style={{
                          color: enabled
                            ? "hsl(var(--kf-accent2))"
                            : "hsl(var(--muted-foreground))",
                        }}
                      />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{type.label}</p>
                      <p className="kf-text-caption text-muted-foreground">{type.description}</p>
                    </div>
                  </div>
                  {/* h-6 w-11 / h-5 w-5: the old h-5.5 and h-4.5 are not Tailwind 3 classes and rendered the switch 0px tall. */}
                  <button
                    onClick={() => togglePreference(type.key)}
                    disabled={saving.has(type.key)}
                    className="relative h-6 w-11 rounded-full transition-colors duration-200 flex-shrink-0"
                    style={{
                      background: enabled
                        ? "hsl(var(--kf-success))"
                        : "hsl(var(--muted))",
                    }}
                    aria-label={`Toggle ${type.label}`}
                    role="switch"
                    aria-checked={enabled}
                  >
                    <span
                      className="absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200"
                      style={{
                        transform: enabled ? "translateX(22px)" : "translateX(2px)",
                      }}
                    />
                    {saving.has(type.key) && (
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
        </motion.div>
      )}

      {activeTab === "log" && logRead.kind === "ok" && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-3"
        >
          {log.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {[
                { label: "Total", count: log.length, color: "var(--kf-accent2)" },
                { label: "Sent", count: log.filter((e) => e.status === "SENT" || e.status === "DRAINED").length, color: "var(--kf-success)" },
                { label: "Queued", count: log.filter((e) => e.status === "QUEUED").length, color: "var(--kf-warning)" },
                { label: "Failed", count: log.filter((e) => e.status === "FAILED").length, color: "var(--kf-error)" },
                { label: "Expired", count: log.filter((e) => e.status === "EXPIRED").length, color: "var(--kf-neutral)" },
              ].map((s) => (
                <div
                  key={s.label}
                  className="rounded-lg border border-border/30 p-3 text-center"
                  style={{ background: `hsl(${s.color} / 0.04)` }}
                >
                  <p className="text-lg font-bold" style={{ color: `hsl(${s.color})` }}>{s.count}</p>
                  <p className="kf-text-micro text-muted-foreground">{s.label}</p>
                </div>
              ))}
            </div>
          )}
          {log.length === 0 ? (
            <div className="text-center py-12">
              <Mail className="w-8 h-8 mx-auto mb-3" style={{ color: "hsl(var(--muted-foreground) / 0.4)" }} />
              <p className="text-sm text-muted-foreground">No customer notifications sent yet</p>
              <p className="kf-text-caption text-muted-foreground mt-1">
                Notifications will appear here once they are triggered
              </p>
            </div>
          ) : (
            <div className="border border-border/40 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
<table className="min-w-full w-full">
                <thead>
                  <tr className="border-b border-border/40 bg-muted/20">
                    <th className="text-left p-3 kf-text-caption font-medium text-muted-foreground">Type</th>
                    <th className="text-left p-3 kf-text-caption font-medium text-muted-foreground">Recipient</th>
                    <th className="text-left p-3 kf-text-caption font-medium text-muted-foreground hidden md:table-cell">Subject</th>
                    <th className="text-left p-3 kf-text-caption font-medium text-muted-foreground">Status</th>
                    <th className="text-left p-3 kf-text-caption font-medium text-muted-foreground hidden sm:table-cell">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {log.map((entry) => {
                    const statusStyle = STATUS_STYLES[entry.status] ?? STATUS_STYLES.QUEUED;
                    return (
                      <tr key={entry.id} className="border-b border-border/20 last:border-0 hover:bg-muted/10">
                        <td className="p-3">
                          <span
                            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md kf-text-caption font-medium"
                            style={{
                              background: "hsl(var(--kf-accent2) / 0.08)",
                              color: "hsl(var(--kf-accent2))",
                            }}
                          >
                            {TYPE_LABELS[entry.type] ?? entry.type}
                          </span>
                        </td>
                        <td className="p-3">
                          <p className="kf-text-body font-medium truncate max-w-[180px]">
                            {entry.recipientName || entry.recipientEmail}
                          </p>
                          {entry.recipientName && (
                            <p className="kf-text-caption text-muted-foreground truncate max-w-[180px]">
                              {entry.recipientEmail}
                            </p>
                          )}
                        </td>
                        <td className="p-3 hidden md:table-cell">
                          <p className="kf-text-caption text-muted-foreground truncate max-w-[220px]">
                            {entry.subject}
                          </p>
                        </td>
                        <td className="p-3">
                          <span
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md kf-text-micro font-medium"
                            style={{
                              background: statusStyle.bg,
                              color: statusStyle.text,
                            }}
                          >
                            {(entry.status === "SENT" || entry.status === "DRAINED") && <CheckCircle2 className="w-3 h-3" />}
                            {(entry.status === "FAILED" || entry.status === "EXPIRED") && <XCircle className="w-3 h-3" />}
                            {entry.status === "QUEUED" && <Clock className="w-3 h-3" />}
                            {statusStyle.label}
                          </span>
                        </td>
                        <td className="p-3 hidden sm:table-cell">
                          <p className="kf-text-caption text-muted-foreground">
                            {new Date(entry.sentAt ?? entry.createdAt).toLocaleDateString("en-TT", {
                              month: "short",
                              day: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </p>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
</div>
            </div>
          )}
        </motion.div>
      )}

      {/* OWNER-ALERTS-WEB (D-154): the business owner's alerts (push first, email fallback) and the install step. */}
      {activeTab === "alerts" && (
        <section aria-label="Owner alerts" className="space-y-3">
          <InstallAppStep />
          <OwnerAlertSettings businessId={getStoredBusinessId()} />
        </section>
      )}
    </div>
  );
}
