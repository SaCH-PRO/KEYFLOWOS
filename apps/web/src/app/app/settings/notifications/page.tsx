"use client";

import { useEffect, useState, useCallback } from "react";
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
import { apiGet, apiPatch } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";
import { InfoBadge } from "@/components/ui/info-badge";
import { toast } from "sonner";

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

export default function NotificationsSettingsPage() {
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [log, setLog] = useState<NotificationLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"preferences" | "log">("preferences");

  const loadData = useCallback(async () => {
    const businessId = getStoredBusinessId();
    if (!businessId) { setLoading(false); return; }
    setLoading(true);
    const [prefsRes, logRes] = await Promise.all([
      apiGet<NotificationPreferences>(`/notifications/businesses/${businessId}/customer-preferences`),
      apiGet<NotificationLogEntry[]>(`/notifications/businesses/${businessId}/customer-log?limit=100`),
    ]);
    if (prefsRes.data) setPreferences(prefsRes.data);
    if (logRes.data) setLog(logRes.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs external or derived state into local component state
    loadData();
  }, [loadData]);

  const togglePreference = async (key: keyof NotificationPreferences) => {
    if (!preferences) return;
    setSaving(key);
    const newValue = !preferences[key];
    const updated = { ...preferences, [key]: newValue };
    setPreferences(updated);
    const businessId = getStoredBusinessId();
    if (!businessId) { setSaving(null); return; }
    const res = await apiPatch(`/notifications/businesses/${businessId}/customer-preferences`, { [key]: newValue });
    if (res.error) {
      setPreferences(preferences);
      toast.error("Failed to update notification preference");
    } else {
      toast.success("Notification preference updated");
    }
    setSaving(null);
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
        {(["preferences", "log"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab
                ? "bg-background text-foreground shadow-sm border border-border/60"
                : "text-muted-foreground hover:text-foreground/80"
            }`}
          >
            {tab === "preferences" ? "Preferences" : `Log (${log.length})`}
          </button>
        ))}
      </div>

      {activeTab === "preferences" && preferences && (
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
                  <button
                    onClick={() => togglePreference(type.key)}
                    disabled={saving === type.key}
                    className="relative w-10 h-5.5 rounded-full transition-colors duration-200 flex-shrink-0"
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
                      className="absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white shadow transition-transform duration-200"
                      style={{
                        transform: enabled ? "translateX(19px)" : "translateX(2px)",
                      }}
                    />
                    {saving === type.key && (
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

      {activeTab === "log" && (
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
              <table className="w-full">
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
          )}
        </motion.div>
      )}
    </div>
  );
}
