"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import {
  Calendar,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RefreshCw,
  Link2,
  Plug,
  Unlink,
  ExternalLink,
  TrendingUp,
  Clock,
  ShieldAlert,
  Cloud,
  Eye,
} from "lucide-react";
import { MetricCard } from "@/components/ui/metric-card";
import { SectionCard } from "@/components/ui/section-card";
import { toast } from "sonner";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { apiGet, apiPostSimple, apiPatch } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";

const EVENT_TYPE_TOGGLES: Array<{
  key: "booking" | "contact_task" | "invoice_due" | "quote_expiry" | "content_post";
  label: string;
  hint: string;
}> = [
  { key: "booking", label: "Bookings", hint: "Push every confirmed booking to Google Calendar" },
  { key: "contact_task", label: "Contact tasks", hint: "Push CRM tasks with a due date" },
  { key: "invoice_due", label: "Invoice due dates", hint: "Block out the day an invoice is due" },
  { key: "quote_expiry", label: "Quote expiries", hint: "Block out the day a quote expires" },
  { key: "content_post", label: "Scheduled content", hint: "Block out social posts and email sends" },
];

interface SyncSettings {
  booking: boolean;
  contact_task: boolean;
  invoice_due: boolean;
  quote_expiry: boolean;
  content_post: boolean;
  pullExternal: boolean;
  defaultVisibility: "PRIVATE" | "TEAM" | "PUBLIC";
  lastResyncAt: string | null;
  lastResyncError: string | null;
  consecutiveErrors: number;
}

interface SyncStatus {
  connected: boolean;
  email: string | null;
  calendarId: string | null;
  syncDirection: string;
  syncEnabled: boolean;
  settings: SyncSettings;
  lastSyncedAt: string | null;
  lastError: string | null;
  consecutiveErrors: number;
  openConflicts: number;
}

interface CalendarChoice {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
}

function formatTimeAgo(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function SettingsConnectionsPage() {
  const businessId = getStoredBusinessId();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [calendars, setCalendars] = useState<CalendarChoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<{ connect?: boolean; disconnect?: boolean; resync?: boolean }>({});

  const refresh = useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const res = await apiGet<SyncStatus>(`/calendar/businesses/${businessId}/sync/status`);
    if (res.data) setStatus(res.data);
    if (res.data?.connected) {
      const cals = await apiGet<CalendarChoice[]>(
        `/calendar/businesses/${businessId}/sync/calendars`,
      );
      if (cals.data) setCalendars(cals.data);
    } else {
      setCalendars([]);
    }
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    // Initial fetch — calling refresh() (which sets state) inside an effect is
    // the standard data-loading pattern here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const param = searchParams?.get("calendar");
    if (param === "success") {
      toast.success("Google Calendar connected");
      window.history.replaceState({}, "", "/app/settings/connections");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void refresh();
    } else if (param === "error") {
      toast.error("Failed to connect Google Calendar");
      window.history.replaceState({}, "", "/app/settings/connections");
    }
  }, [searchParams, refresh]);

  const handleConnect = async () => {
    if (!businessId) return;
    setBusy((b) => ({ ...b, connect: true }));
    const res = await apiPostSimple<{ url: string }>(
      `/calendar/businesses/${businessId}/sync/google/connect`,
      {},
    );
    if (res.error || !res.data?.url) {
      toast.error(res.error || "Could not start Google OAuth");
      setBusy((b) => ({ ...b, connect: false }));
      return;
    }
    window.location.href = res.data.url;
  };

  const handleDisconnect = async () => {
    if (!businessId) return;
    if (!window.confirm("Disconnect Google Calendar? Bookings will stop syncing.")) return;
    setBusy((b) => ({ ...b, disconnect: true }));
    const res = await apiPostSimple(
      `/calendar/businesses/${businessId}/sync/google/disconnect`,
      {},
    );
    if (res.error) toast.error(res.error);
    else toast.success("Disconnected");
    await refresh();
    setBusy((b) => ({ ...b, disconnect: false }));
  };

  const handleResync = async () => {
    if (!businessId) return;
    setBusy((b) => ({ ...b, resync: true }));
    const res = await apiPostSimple<{ pushed: number; pulled: number; errors: string[] }>(
      `/calendar/businesses/${businessId}/sync/google/resync`,
      {},
    );
    if (res.error) {
      toast.error(res.error);
    } else if (res.data) {
      const { pushed, pulled, errors } = res.data;
      if (errors.length) toast.error(`Resync had errors: ${errors.join("; ")}`);
      else toast.success(`Resync complete — ${pushed} pushed, ${pulled} pulled`);
    }
    await refresh();
    setBusy((b) => ({ ...b, resync: false }));
  };

  const handleSettingChange = async (patch: Partial<SyncSettings>) => {
    if (!businessId || !status) return;
    setStatus({ ...status, settings: { ...status.settings, ...patch } });
    const res = await apiPatch<SyncSettings>(
      `/calendar/businesses/${businessId}/sync/settings`,
      patch,
    );
    if (res.error) {
      toast.error(res.error);
      void refresh();
    } else if (res.data) {
      setStatus((s) => (s ? { ...s, settings: res.data! } : s));
    }
  };

  const handleCalendarChoice = async (calendarId: string) => {
    if (!businessId) return;
    const res = await apiPatch(
      `/calendar/businesses/${businessId}/sync/settings`,
      { calendarId },
    );
    if (res.error) toast.error(res.error);
    else {
      toast.success("Calendar updated");
      await refresh();
    }
  };

  const handleDirectionChange = async (syncDirection: string) => {
    if (!businessId) return;
    const res = await apiPatch(
      `/calendar/businesses/${businessId}/sync/settings`,
      { syncDirection },
    );
    if (res.error) toast.error(res.error);
    else {
      toast.success("Sync direction updated");
      await refresh();
    }
  };

  return (
    <WorkspaceShell
      icon={Plug}
      title="Connections"
      subtitle="Manage how KeyFlow syncs with the rest of your stack"
    >
      <div className="space-y-6 max-w-3xl">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/app/connect" className="hover:text-foreground inline-flex items-center gap-1">
            <Plug className="h-3.5 w-3.5" />
            All connectors
          </Link>
          <span>/</span>
          <span className="text-foreground">Google Calendar</span>
        </div>

        {/* Sync Stats */}
        {!loading && status && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 }}>
              <MetricCard
                label="Status"
                value={status.connected ? "Connected" : "Disconnected"}
                icon={Cloud}
                iconColor={status.connected ? "#10b981" : "#ef4444"}
              />
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
              <MetricCard
                label="Last Sync"
                value={formatTimeAgo(status.lastSyncedAt)}
                icon={Clock}
              />
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
              <MetricCard
                label="Conflicts"
                value={status.openConflicts}
                icon={ShieldAlert}
                iconColor={status.openConflicts > 0 ? "#ef4444" : "#10b981"}
              />
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
              <MetricCard
                label="Sync Direction"
                value={status.syncDirection === "two_way" ? "Two-way" : status.syncDirection === "push" ? "Push" : status.syncDirection === "pull" ? "Pull" : "Paused"}
                icon={TrendingUp}
              />
            </motion.div>
          </div>
        )}

        {!businessId ? (
          <div className="rounded-2xl border border-border/40 p-8 text-sm text-muted-foreground">
            Select a workspace to manage its connections.
          </div>
        ) : loading ? (
          <div className="rounded-2xl border border-border/40 p-8 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className={`rounded-2xl border p-6 ${
              status?.connected
                ? "border-emerald-500/20 bg-emerald-500/[0.03]"
                : "border-border/40 bg-card/40"
            }`}
          >
            <header className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-blue-500/20 to-red-500/20 border border-border/30 flex items-center justify-center">
                  <Calendar className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-medium flex items-center gap-2">
                    Google Calendar
                    {status?.connected ? (
                      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                        <CheckCircle2 className="h-2.5 w-2.5" />
                        Connected
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-zinc-500/10 text-zinc-400 border border-zinc-500/30">
                        Not connected
                      </span>
                    )}
                  </h2>
                  <p className="text-xs text-muted-foreground mt-1 max-w-md">
                    Push KeyFlow events (bookings, tasks, deadlines) to your Google Calendar and
                    optionally pull external Google events back into the master calendar.
                  </p>
                  {status?.email && (
                    <p className="text-[11px] text-muted-foreground mt-1">{status.email}</p>
                  )}
                  {status?.connected && (
                    <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground flex-wrap">
                      <span className="inline-flex items-center gap-1">
                        <RefreshCw className="h-3 w-3" />
                        Last resync: {formatTimeAgo(status.lastSyncedAt)}
                      </span>
                      {status.openConflicts > 0 && (
                        <Link
                          href="/app/connect/calendar"
                          className="inline-flex items-center gap-1 text-amber-400 hover:text-amber-300"
                        >
                          <AlertCircle className="h-3 w-3" />
                          {status.openConflicts} conflict
                          {status.openConflicts === 1 ? "" : "s"}
                        </Link>
                      )}
                      {status.lastError && (
                        <span className="inline-flex items-center gap-1 text-red-400">
                          <AlertCircle className="h-3 w-3" />
                          {status.lastError.slice(0, 80)}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {status?.connected ? (
                  <>
                    <button
                      type="button"
                      onClick={handleResync}
                      disabled={busy.resync}
                      className="inline-flex items-center h-8 px-2 text-xs rounded-md border border-border/40 hover:bg-muted/40 disabled:opacity-50"
                    >
                      {busy.resync ? (
                        <Loader2 className="h-3 w-3 animate-spin mr-1" />
                      ) : (
                        <RefreshCw className="h-3 w-3 mr-1" />
                      )}
                      Resync now
                    </button>
                    <button
                      type="button"
                      onClick={handleDisconnect}
                      disabled={busy.disconnect}
                      className="inline-flex items-center h-8 px-2 text-xs rounded-md border border-red-500/30 text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                    >
                      <Unlink className="h-3 w-3 mr-1" />
                      Disconnect
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={handleConnect}
                    disabled={busy.connect}
                    className="inline-flex items-center h-8 px-3 text-xs rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50"
                  >
                    {busy.connect ? (
                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    ) : (
                      <Link2 className="h-3 w-3 mr-1" />
                    )}
                    Connect Google Calendar
                  </button>
                )}
              </div>
            </header>

            {status?.connected && (
              <div className="mt-6 space-y-6">
                <SectionCard title="Target Calendar" icon={Calendar} compact noPadding>
                  <div className="p-3">
                    <div className="flex flex-wrap gap-2">
                    {calendars.length === 0 && (
                      <span className="text-xs text-muted-foreground">No writable calendars</span>
                    )}
                    {calendars.map((cal) => {
                      const active =
                        (status.calendarId ?? "primary") === cal.id ||
                        (cal.primary && !status.calendarId);
                      return (
                        <button
                          key={cal.id}
                          onClick={() => handleCalendarChoice(cal.id)}
                          className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                            active
                              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                              : "bg-muted/30 border-border/40 hover:bg-muted/50"
                          }`}
                        >
                          {cal.summary}
                          {cal.primary && (
                            <span className="ml-1 text-[10px] opacity-60">(primary)</span>
                          )}
                        </button>
                      );
                    })}
                    </div>
                  </div>
                </SectionCard>

                <SectionCard title="Sync Direction" icon={TrendingUp} compact noPadding>
                  <div className="p-3">
                    <div className="flex flex-wrap gap-2">
                    {(
                      [
                        ["two_way", "Two-way"],
                        ["push", "Push only"],
                        ["pull", "Pull only"],
                        ["disabled", "Paused"],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        onClick={() => handleDirectionChange(value)}
                        className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                          status.syncDirection === value
                            ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                            : "bg-muted/30 border-border/40 hover:bg-muted/50"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                    </div>
                  </div>
                </SectionCard>

                <SectionCard title="What to Sync" icon={Plug} compact noPadding>
                  <div className="p-3 space-y-2">
                    {EVENT_TYPE_TOGGLES.map((t) => (
                      <label
                        key={t.key}
                        className="flex items-start gap-3 p-3 rounded-lg border border-border/40 bg-muted/20 hover:bg-muted/30 transition-colors cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={!!status.settings[t.key]}
                          onChange={(e) =>
                            handleSettingChange({ [t.key]: e.target.checked } as Partial<SyncSettings>)
                          }
                          className="mt-0.5"
                        />
                        <div className="min-w-0">
                          <div className="text-sm">{t.label}</div>
                          <div className="text-[11px] text-muted-foreground">{t.hint}</div>
                        </div>
                      </label>
                    ))}
                    <label className="flex items-start gap-3 p-3 rounded-lg border border-border/40 bg-muted/20 hover:bg-muted/30 transition-colors cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!status.settings.pullExternal}
                        onChange={(e) =>
                          handleSettingChange({ pullExternal: e.target.checked })
                        }
                        className="mt-0.5"
                      />
                      <div className="min-w-0">
                        <div className="text-sm">Pull external Google events</div>
                        <div className="text-[11px] text-muted-foreground">
                          Mirror events from the chosen Google calendar onto the master calendar
                          as read-only EXTERNAL_GOOGLE_EVENT entries.
                        </div>
                      </div>
                    </label>
                  </div>
                </SectionCard>

                <SectionCard title="Default Visibility" icon={Eye} compact noPadding>
                  <div className="p-3">
                    <div className="flex flex-wrap gap-2">
                    {(["PRIVATE", "TEAM", "PUBLIC"] as const).map((v) => (
                      <button
                        key={v}
                        onClick={() => handleSettingChange({ defaultVisibility: v })}
                        className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                          status.settings.defaultVisibility === v
                            ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                            : "bg-muted/30 border-border/40 hover:bg-muted/50"
                        }`}
                      >
                        {v.charAt(0) + v.slice(1).toLowerCase()}
                      </button>
                    ))}
                    </div>
                  </div>
                </SectionCard>

                <div className="pt-4 border-t border-border/30 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Hourly resync runs in the background.</span>
                  <Link
                    href="/app/connect/calendar"
                    className="inline-flex items-center gap-1 hover:text-foreground"
                  >
                    Conflict log
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>
              </div>
            )}
          </motion.section>
        )}
      </div>
    </WorkspaceShell>
  );
}
