"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Badge, Button, Input } from "@keyflow/ui";
import {
  Contact,
  ContactEvent,
  ContactTask,
  fetchContacts,
  fetchContactEvents,
  fetchDueTasks,
  fetchSegmentSummary,
} from "@/lib/client";

type SegmentCounts = { [key: string]: number };

function Card({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-2xl border border-border/60 bg-slate-950/60 p-4 shadow-[0_0_30px_rgba(0,0,0,0.35)]">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-white">{title}</p>
        {action}
      </div>
      {children}
    </section>
  );
}

export default function CrmDashboardPage() {
  const [segments, setSegments] = useState<SegmentCounts>({});
  const [tasks, setTasks] = useState<ContactTask[]>([]);
  const [events, setEvents] = useState<ContactEvent[]>([]);
  const [topContacts, setTopContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState("");
  const [, startTransition] = useTransition();

  useEffect(() => {
    startTransition(() => {
      void fetchSegmentSummary().then(({ data }) => setSegments(data ?? {}));
      void fetchDueTasks().then(({ data }) => setTasks(data ?? []));
      void fetchContactEvents("").then(() => {}); // placeholder to keep API shape consistent
    });
  }, []);

  useEffect(() => {
    startTransition(() => {
      void fetchContactEvents(search ? search : "")
        .then((res) => setEvents(res.data ?? []))
        .catch(() => setEvents([]));
    });
  }, [search]);

  useEffect(() => {
    startTransition(() => {
      void fetchContacts(undefined, { includeStats: true, take: 10 })
        .then(({ data }) => {
          const sorted = (data ?? []).sort(
            (a, b) => (b.meta?.leadScore ?? 0) - (a.meta?.leadScore ?? 0),
          );
          setTopContacts(sorted.slice(0, 6));
        })
        .catch(() => setTopContacts([]));
    });
  }, []);

  const segmentKeys: Array<{ key: string; label: string; tone: "info" | "success" | "warning" | "danger" | "default" }> =
    [
      { key: "lead", label: "Leads", tone: "info" },
      { key: "prospect", label: "Prospects", tone: "default" },
      { key: "client", label: "Clients", tone: "success" },
      { key: "lost", label: "Lost", tone: "warning" },
      { key: "unpaid", label: "Unpaid", tone: "danger" },
      { key: "stale", label: "Stale", tone: "warning" },
      { key: "newThisWeek", label: "New This Week", tone: "info" },
    ];

  const overdueTasks = useMemo(() => tasks.filter((t) => t.status !== "DONE"), [tasks]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">CRM Dashboard</h1>
          <p className="text-sm text-muted-foreground">Highlights, segments, and recent activity for your contacts.</p>
        </div>
        <Link href="/app/crm/pipeline">
          <Button variant="outline">Go to pipeline</Button>
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card
          title="Segments"
          action={<Badge tone="info">{Object.values(segments).reduce((a, b) => a + (b ?? 0), 0)} total</Badge>}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            {segmentKeys.map((segment) => (
              <div
                key={segment.key}
                className="rounded-2xl border border-border/50 bg-slate-900/70 p-3 text-sm"
              >
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>{segment.label}</span>
                  <Badge tone={segment.tone}>{segments[segment.key] ?? 0}</Badge>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="High potential" action={<Badge tone="info">{topContacts.length}</Badge>}>
          <div className="space-y-2">
            {topContacts.map((c) => (
              <div
                key={c.id}
                className="rounded-xl border border-border/50 bg-slate-900/70 p-2 text-sm text-white"
              >
                <div className="flex items-center justify-between">
                  <span>{`${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || "Unnamed"}</span>
                  <Badge tone="success">Score {c.meta?.leadScore ?? "–"}</Badge>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {c.email || c.phone || "No contact info"}
                </div>
                <div className="flex flex-wrap gap-1 text-[11px] text-muted-foreground">
                  {(c.tags ?? []).slice(0, 3).map((t) => (
                    <span key={t} className="rounded-full border border-border/50 px-2 py-0.5">
                      {t}
                    </span>
                  ))}
                  {(c.meta?.outstandingBalance ?? 0) > 0 && (
                    <span className="rounded-full border border-amber-500/50 text-amber-200 px-2 py-0.5">
                      Owed {(c.meta?.outstandingBalance ?? 0).toLocaleString()}
                    </span>
                  )}
                </div>
              </div>
            ))}
            {topContacts.length === 0 && <p className="text-xs text-muted-foreground">No contacts yet.</p>}
          </div>
        </Card>

        <Card title="Due / overdue tasks" action={<Badge tone="warning">{overdueTasks.length}</Badge>}>
          <div className="space-y-2">
            {overdueTasks.slice(0, 6).map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between rounded-xl border border-border/50 bg-slate-900/60 p-2"
              >
                <div>
                  <div className="text-sm font-semibold text-white">{t.title}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {t.contact
                      ? `${t.contact.firstName ?? ""} ${t.contact.lastName ?? ""}`.trim() ||
                        t.contact.email ||
                        t.contact.phone
                      : ""}
                  </div>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {t.dueDate ? new Date(t.dueDate).toLocaleDateString() : "No due"}
                </div>
              </div>
            ))}
            {overdueTasks.length === 0 && <p className="text-xs text-muted-foreground">No open tasks.</p>}
          </div>
        </Card>
      </div>

      <Card
        title="Recent activity"
        action={
          <div className="flex items-center gap-2">
            <Input
              placeholder="Filter events by contact id"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-48 text-xs"
            />
            <Badge tone="info">{events.length} events</Badge>
          </div>
        }
      >
        {events.length === 0 ? (
          <p className="text-xs text-muted-foreground">No recent events.</p>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {events.slice(0, 10).map((event) => (
              <div key={event.id} className="rounded-xl border border-border/50 bg-slate-950/60 p-2 text-[11px] text-muted-foreground">
                <div className="flex items-center justify-between text-white">
                  <span className="font-semibold">{event.type}</span>
                  <span className="text-[10px] text-slate-400">{new Date(event.createdAt).toLocaleString()}</span>
                </div>
                <p className="line-clamp-2">
                  {event.data && typeof event.data === "object"
                    ? JSON.stringify(event.data).slice(0, 120)
                    : String(event.data)}
                </p>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
