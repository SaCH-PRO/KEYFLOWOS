"use client";

import { useEffect, useState, useCallback } from "react";
import { apiGet } from "@/lib/api";

type AuditEntry = {
  id: string;
  event: string;
  outcome: string;
  email: string | null;
  userId: string | null;
  ip: string | null;
  userAgent: string | null;
  reason: string | null;
  metadata: unknown;
  createdAt: string;
};

const EVENT_OPTIONS = [
  { value: "", label: "All events" },
  { value: "signup", label: "Signup" },
  { value: "login_success", label: "Login (success)" },
  { value: "login_failure", label: "Login (failure)" },
  { value: "rate_limited", label: "Rate-limited" },
  { value: "resend_verification", label: "Resend verification" },
];

const OUTCOME_BADGE: Record<string, string> = {
  success: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  failure: "bg-rose-500/15 text-rose-400 border-rose-500/30",
  rate_limited: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  error: "bg-rose-500/15 text-rose-400 border-rose-500/30",
};

/**
 * Admin Security page — surfaces the auth audit log captured by the
 * backend `AuthSecurityService` during signup / login / resend /
 * rate-limit events. Restricted to SUPER_ADMIN at the API layer; this
 * page renders an empty state with a friendly note when the caller
 * isn't authorised.
 */
export default function SecuritySettingsPage() {
  const [eventFilter, setEventFilter] = useState<string>("");
  const [emailFilter, setEmailFilter] = useState<string>("");
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ limit: "100" });
    if (eventFilter) params.set("event", eventFilter);
    if (emailFilter) params.set("email", emailFilter.trim());
    const res = await apiGet<{ entries: AuditEntry[]; count: number }>(
      `/identity/admin/auth-audit?${params.toString()}`,
    );
    if (res.error) {
      setError(res.error);
      setEntries([]);
    } else {
      setEntries(res.data?.entries ?? []);
    }
    setLoading(false);
  }, [eventFilter, emailFilter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs external or derived state into local component state
    load();
  }, [load]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Auth Audit Log</h1>
        <p className="text-sm text-muted-foreground">
          Every signup, sign-in attempt and rate-limit event recorded by the auth-hardening layer.
          Admin-only.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-xs text-muted-foreground">
          Event
          <select
            value={eventFilter}
            onChange={(e) => setEventFilter(e.target.value)}
            className="mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            {EVENT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-muted-foreground">
          Email contains
          <input
            type="email"
            value={emailFilter}
            onChange={(e) => setEmailFilter(e.target.value)}
            placeholder="user@example.com"
            className="mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </label>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="rounded-md border border-border bg-card px-4 py-2 text-sm hover:bg-accent disabled:opacity-50"
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error.toLowerCase().includes("admin") || error.toLowerCase().includes("unauthor")
            ? "You need SUPER_ADMIN privileges to view the auth audit log."
            : `Couldn't load audit log: ${error}`}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-muted/30 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Event</th>
              <th className="px-3 py-2">Outcome</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">IP</th>
              <th className="px-3 py-2">Reason</th>
            </tr>
          </thead>
          <tbody>
            {entries === null ? null : entries.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                  {loading ? "Loading…" : "No audit entries match this filter."}
                </td>
              </tr>
            ) : (
              entries.map((entry) => (
                <tr key={entry.id} className="border-b border-border/40 last:border-0">
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {new Date(entry.createdAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{entry.event}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-md border px-2 py-0.5 text-xs ${
                        OUTCOME_BADGE[entry.outcome] ?? "border-border bg-muted text-muted-foreground"
                      }`}
                    >
                      {entry.outcome}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs">{entry.email ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs">{entry.ip ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{entry.reason ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Showing the most recent 100 entries. Older events remain in the database; query the
        `auth_audit_logs` table directly for forensic investigation.
      </p>
    </div>
  );
}
