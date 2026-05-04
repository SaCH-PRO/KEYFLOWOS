"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Calendar,
  ChevronLeft,
  Loader2,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  ArrowLeftRight,
  ArrowUpRight,
  ArrowDownLeft,
  Ban,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Button, Badge } from "@keyflow/ui";
import { apiGet, apiPostSimple, apiPatch } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";

interface CalendarStatus {
  connected: boolean;
  email?: string;
  calendarId?: string;
  syncDirection?: "push" | "pull" | "two_way" | "disabled";
  syncEnabled?: boolean;
}

interface AvailableCalendar {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
  backgroundColor?: string;
}

interface ConflictRow {
  id: string;
  bookingId: string | null;
  externalEventId: string | null;
  conflictType: string;
  summary: string;
  externalSummary: string | null;
  bookingStart: string | null;
  bookingEnd: string | null;
  externalStart: string | null;
  externalEnd: string | null;
  status: string;
  createdAt: string;
}

const DIRECTION_OPTIONS: Array<{
  value: "two_way" | "push" | "pull" | "disabled";
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    value: "two_way",
    label: "Two-way sync",
    description: "Push KeyFlow bookings to Google and pull external events back.",
    icon: ArrowLeftRight,
  },
  {
    value: "push",
    label: "Push only",
    description: "Send KeyFlow bookings to Google. Don't pull external events.",
    icon: ArrowUpRight,
  },
  {
    value: "pull",
    label: "Pull only",
    description: "Read external Google events. Don't push KeyFlow bookings.",
    icon: ArrowDownLeft,
  },
  {
    value: "disabled",
    label: "Paused",
    description: "Keep credentials but stop all sync activity.",
    icon: Ban,
  },
];

function formatRange(start: string | null, end: string | null) {
  if (!start) return "—";
  const s = new Date(start);
  const e = end ? new Date(end) : null;
  const sameDay = e && s.toDateString() === e.toDateString();
  const dateOpts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const timeOpts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  if (!e) return `${s.toLocaleDateString(undefined, dateOpts)} ${s.toLocaleTimeString(undefined, timeOpts)}`;
  if (sameDay) {
    return `${s.toLocaleDateString(undefined, dateOpts)} ${s.toLocaleTimeString(undefined, timeOpts)} – ${e.toLocaleTimeString(undefined, timeOpts)}`;
  }
  return `${s.toLocaleDateString(undefined, dateOpts)} ${s.toLocaleTimeString(undefined, timeOpts)} → ${e.toLocaleDateString(undefined, dateOpts)} ${e.toLocaleTimeString(undefined, timeOpts)}`;
}

export default function CalendarSyncPage() {
  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [calendars, setCalendars] = useState<AvailableCalendar[]>([]);
  const [conflicts, setConflicts] = useState<ConflictRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [calendarsLoading, setCalendarsLoading] = useState(false);
  const [savingId, setSavingId] = useState(false);
  const [savingDirection, setSavingDirection] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const businessId = getStoredBusinessId();

  const refresh = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    const [statusRes, conflictsRes] = await Promise.all([
      apiGet<CalendarStatus>(`/bookings/businesses/${businessId}/calendar/status`),
      apiGet<ConflictRow[]>(`/bookings/businesses/${businessId}/calendar/conflicts?status=open`),
    ]);
    if (statusRes.data) setStatus(statusRes.data);
    if (conflictsRes.data) setConflicts(conflictsRes.data);
    setLoading(false);
  }, [businessId]);

  const loadCalendars = useCallback(async () => {
    if (!businessId) return;
    setCalendarsLoading(true);
    const res = await apiGet<AvailableCalendar[]>(`/bookings/businesses/${businessId}/calendar/list`);
    if (res.error) toast.error(res.error);
    else if (res.data) setCalendars(res.data);
    setCalendarsLoading(false);
  }, [businessId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrates server state
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (status?.connected) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch on connect
      loadCalendars();
    }
  }, [status?.connected, loadCalendars]);

  const handleCalendarChange = async (calendarId: string) => {
    if (!businessId) return;
    setSavingId(true);
    const res = await apiPatch<{ calendarId: string | null }>(
      `/bookings/businesses/${businessId}/calendar/settings`,
      { calendarId },
    );
    if (res.error) toast.error(res.error);
    else {
      toast.success("Calendar updated");
      setStatus((prev) => (prev ? { ...prev, calendarId } : prev));
    }
    setSavingId(false);
  };

  const handleDirectionChange = async (direction: "push" | "pull" | "two_way" | "disabled") => {
    if (!businessId) return;
    setSavingDirection(true);
    const res = await apiPatch<{ syncDirection: string }>(
      `/bookings/businesses/${businessId}/calendar/settings`,
      { syncDirection: direction },
    );
    if (res.error) toast.error(res.error);
    else {
      toast.success("Sync direction updated");
      setStatus((prev) => (prev ? { ...prev, syncDirection: direction } : prev));
    }
    setSavingDirection(false);
  };

  const handleScan = async () => {
    if (!businessId) return;
    setScanning(true);
    const res = await apiPostSimple<{ created: number; total: number }>(
      `/bookings/businesses/${businessId}/calendar/conflicts/scan`,
      {},
    );
    if (res.error) toast.error(res.error);
    else {
      const data = res.data;
      toast.success(
        data && data.created > 0
          ? `Found ${data.created} new conflict${data.created === 1 ? "" : "s"}`
          : "No new conflicts detected",
      );
      await refresh();
    }
    setScanning(false);
  };

  const handleResolve = async (
    conflictId: string,
    resolution: "keep_keyflow" | "keep_external" | "dismissed",
  ) => {
    if (!businessId) return;
    setResolvingId(conflictId);
    const res = await apiPostSimple(
      `/bookings/businesses/${businessId}/calendar/conflicts/${conflictId}/resolve`,
      { resolution },
    );
    if (res.error) toast.error(res.error);
    else {
      toast.success("Conflict resolved");
      setConflicts((prev) => prev.filter((c) => c.id !== conflictId));
    }
    setResolvingId(null);
  };

  if (!businessId) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Select a workspace to manage calendar sync.
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6 max-w-4xl">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Link href="/app/connect" className="inline-flex items-center hover:text-foreground">
          <ChevronLeft className="h-3 w-3 mr-1" />
          Back to Connect hub
        </Link>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-border/40 p-5 bg-gradient-to-br from-blue-500/5 to-transparent"
      >
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center">
              <Calendar className="h-5 w-5 text-blue-300" />
            </div>
            <div>
              <h1 className="text-base md:text-lg font-semibold">Google Calendar sync</h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Pick the calendar to sync, choose direction, and resolve conflicts when KeyFlow and Google disagree.
              </p>
            </div>
          </div>
          {status?.connected ? (
            <Badge className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Connected{status.email ? ` — ${status.email}` : ""}
            </Badge>
          ) : (
            <Badge className="bg-zinc-500/10 text-zinc-400 border border-zinc-500/30">
              Not connected
            </Badge>
          )}
        </div>
      </motion.div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…
        </div>
      ) : !status?.connected ? (
        <div className="rounded-2xl border border-border/40 p-6 text-sm text-muted-foreground">
          Connect Google Calendar from the{" "}
          <Link href="/app/connect" className="text-foreground underline">
            Connect hub
          </Link>{" "}
          to configure sync.
        </div>
      ) : (
        <>
          <section className="rounded-2xl border border-border/40 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold">Calendar to sync</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Bookings and external events flow to and from this calendar.
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={loadCalendars}
                disabled={calendarsLoading}
                className="h-7 px-2 text-xs"
              >
                {calendarsLoading ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                ) : (
                  <RefreshCw className="h-3 w-3 mr-1" />
                )}
                Reload calendars
              </Button>
            </div>

            {calendarsLoading && calendars.length === 0 ? (
              <div className="text-xs text-muted-foreground py-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin inline mr-1.5" />
                Fetching calendars…
              </div>
            ) : calendars.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No calendars returned. Make sure Google Calendar is authorized with write access.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {calendars.map((cal) => {
                  const selected =
                    (status.calendarId ?? "primary") === cal.id ||
                    (!status.calendarId && cal.primary);
                  return (
                    <button
                      key={cal.id}
                      type="button"
                      onClick={() => handleCalendarChange(cal.id)}
                      disabled={savingId}
                      className={`text-left rounded-xl border p-3 transition-all ${
                        selected
                          ? "border-blue-500/50 bg-blue-500/[0.08]"
                          : "border-border/40 hover:border-border/70 bg-card/40"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="h-3 w-3 rounded-full shrink-0 border border-border/40"
                          style={{ background: cal.backgroundColor ?? "#4f46e5" }}
                        />
                        <span className="text-sm truncate flex-1">{cal.summary}</span>
                        {cal.primary && (
                          <span className="text-[10px] text-muted-foreground">primary</span>
                        )}
                        {selected && <CheckCircle2 className="h-3.5 w-3.5 text-blue-300" />}
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-1 truncate">
                        {cal.id} · {cal.accessRole}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-border/40 p-5 space-y-4">
            <div>
              <h2 className="text-sm font-semibold">Sync direction</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Decide how KeyFlow and Google Calendar exchange events.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {DIRECTION_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const active = (status.syncDirection ?? "two_way") === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => handleDirectionChange(opt.value)}
                    disabled={savingDirection}
                    className={`text-left rounded-xl border p-3 transition-all ${
                      active
                        ? "border-blue-500/50 bg-blue-500/[0.08]"
                        : "border-border/40 hover:border-border/70 bg-card/40"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-blue-300" />
                      <span className="text-sm font-medium">{opt.label}</span>
                      {active && (
                        <CheckCircle2 className="h-3.5 w-3.5 text-blue-300 ml-auto" />
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">{opt.description}</p>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="rounded-2xl border border-border/40 p-5 space-y-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <h2 className="text-sm font-semibold flex items-center gap-2">
                  Conflict log
                  {conflicts.length > 0 && (
                    <Badge className="bg-amber-500/10 text-amber-400 border border-amber-500/30">
                      {conflicts.length} open
                    </Badge>
                  )}
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Overlaps between KeyFlow bookings and Google Calendar events. Resolve to keep one source of truth.
                </p>
              </div>
              <Button
                size="sm"
                variant="default"
                onClick={handleScan}
                disabled={scanning}
                className="h-7 px-3 text-xs"
              >
                {scanning ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                ) : (
                  <ShieldCheck className="h-3 w-3 mr-1" />
                )}
                Scan now
              </Button>
            </div>

            {conflicts.length === 0 ? (
              <div className="text-center py-8 text-xs text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 inline mr-1.5 text-emerald-400" />
                No open conflicts. Run a scan to check again.
              </div>
            ) : (
              <ul className="space-y-2">
                {conflicts.map((c) => (
                  <li
                    key={c.id}
                    className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-3"
                  >
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium truncate">{c.summary}</span>
                          <Badge className="bg-zinc-500/10 text-zinc-300 border border-zinc-500/30 text-[10px]">
                            {c.conflictType.replace("_", " ")}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2 text-[11px] text-muted-foreground">
                          {(c.bookingStart || c.bookingEnd) && (
                            <div className="rounded-md border border-border/30 px-2 py-1.5 bg-card/40">
                              <div className="text-[10px] uppercase tracking-wider">KeyFlow booking</div>
                              <div className="text-foreground/90 mt-0.5">
                                {formatRange(c.bookingStart, c.bookingEnd)}
                              </div>
                            </div>
                          )}
                          {(c.externalStart || c.externalEnd || c.externalSummary) && (
                            <div className="rounded-md border border-border/30 px-2 py-1.5 bg-card/40">
                              <div className="text-[10px] uppercase tracking-wider">Google Calendar</div>
                              <div className="text-foreground/90 mt-0.5 truncate">
                                {c.externalSummary ?? "External event"}
                              </div>
                              {(c.externalStart || c.externalEnd) && (
                                <div className="mt-0.5">
                                  {formatRange(c.externalStart, c.externalEnd)}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          <Button
                            size="sm"
                            variant="default"
                            disabled={resolvingId === c.id}
                            onClick={() => handleResolve(c.id, "keep_keyflow")}
                            className="h-7 px-2 text-xs"
                          >
                            {resolvingId === c.id ? (
                              <Loader2 className="h-3 w-3 animate-spin mr-1" />
                            ) : null}
                            Keep KeyFlow booking
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={resolvingId === c.id}
                            onClick={() => handleResolve(c.id, "keep_external")}
                            className="h-7 px-2 text-xs"
                          >
                            Keep Google event
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={resolvingId === c.id}
                            onClick={() => handleResolve(c.id, "dismissed")}
                            className="h-7 px-2 text-xs text-muted-foreground"
                          >
                            Dismiss
                          </Button>
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
