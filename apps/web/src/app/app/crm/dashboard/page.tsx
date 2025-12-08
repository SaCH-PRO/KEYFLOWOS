"use client";

import { ReactNode, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Badge, Button, Card, CardGrid, ContentContainer, Drawer, Input, PageHeader } from "@keyflow/ui";
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

function SectionCard({
  title,
  children,
  action,
  className = "",
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <Card
      className={`space-y-3 rounded-xl border border-slate-200 bg-white shadow-sm hover:shadow-md transition-shadow ${className}`}
      padding="lg"
      shadow="sm"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        {action}
      </div>
      {children}
    </Card>
  );
}

export default function CrmDashboardPage() {
  const [segments, setSegments] = useState<SegmentCounts>({});
  const [tasks, setTasks] = useState<ContactTask[]>([]);
  const [events, setEvents] = useState<ContactEvent[]>([]);
  const [topContacts, setTopContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState("");
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [, startTransition] = useTransition();

  useEffect(() => {
    startTransition(() => {
      void fetchSegmentSummary().then(({ data }) => setSegments(data ?? {}));
      void fetchDueTasks().then(({ data }) => setTasks(data ?? []));
      void fetchContactEvents("").then(() => {});
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
  const totalContacts = useMemo(
    () => Object.values(segments).reduce((a, b) => a + (b ?? 0), 0),
    [segments],
  );
  const insights = useMemo(
    () => [
      { label: "New this week", value: segments.newThisWeek ?? 0, tone: "info" as const, hint: "Fresh leads to nurture now." },
      { label: "Overdue tasks", value: overdueTasks.length, tone: "warning" as const, hint: "Clear these to keep momentum." },
      { label: "Unpaid accounts", value: segments.unpaid ?? 0, tone: "danger" as const, hint: "Reach out with flexible options." },
      { label: "High scorers", value: topContacts.length, tone: "success" as const, hint: "Prioritize follow-ups with top scores." },
    ],
    [overdueTasks.length, segments.newThisWeek, segments.unpaid, topContacts.length],
  );

  return (
    <ContentContainer>
      <PageHeader
        title="CRM Dashboard"
        subtitle="Highlights, segments, and recent activity for your contacts."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setInsightsOpen(true)}>
              Insights
            </Button>
            <Link href="/app/crm/pipeline">
              <Button variant="outline" size="sm">
                Go to pipeline
              </Button>
            </Link>
          </div>
        }
      />

      <CardGrid>
        <SectionCard
          title="Segments"
          action={<Badge tone="info">{Object.values(segments).reduce((a, b) => a + (b ?? 0), 0)} total</Badge>}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            {segmentKeys.map((segment) => (
              <div
                key={segment.key}
                className="rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex items-center justify-between text-slate-600">
                  <span>{segment.label}</span>
                  <Badge tone={segment.tone}>{segments[segment.key] ?? 0}</Badge>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="High potential" action={<Badge tone="info">{topContacts.length}</Badge>}>
          <div className="space-y-2">
            {topContacts.map((c) => (
              <div
                key={c.id}
                className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex items-center justify-between">
                  <span>{`${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || "Unnamed"}</span>
                  <Badge tone="success">Score {c.meta?.leadScore ?? "-"}</Badge>
                </div>
                <div className="text-[11px] text-slate-500">
                  {c.email || c.phone || "No contact info"}
                </div>
                <div className="flex flex-wrap gap-1 text-[11px] text-slate-500">
                  {(c.tags ?? []).slice(0, 3).map((t) => (
                    <span key={t} className="rounded-full border border-slate-200 px-2 py-0.5">
                      {t}
                    </span>
                  ))}
                  {(c.meta?.outstandingBalance ?? 0) > 0 && (
                    <span className="rounded-full border border-amber-200 text-amber-700 px-2 py-0.5">
                      Owed {(c.meta?.outstandingBalance ?? 0).toLocaleString()}
                    </span>
                  )}
                </div>
              </div>
            ))}
            {topContacts.length === 0 && <p className="text-xs text-slate-500">No contacts yet.</p>}
          </div>
        </SectionCard>

        <SectionCard title="Due / overdue tasks" action={<Badge tone="warning">{overdueTasks.length}</Badge>}>
          <div className="space-y-2">
            {overdueTasks.slice(0, 6).map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-2 shadow-sm hover:shadow-md transition-shadow"
              >
                <div>
                  <div className="text-sm font-semibold text-slate-900">{t.title}</div>
                  <div className="text-[11px] text-slate-500">
                    {t.contact
                      ? `${t.contact.firstName ?? ""} ${t.contact.lastName ?? ""}`.trim() ||
                        t.contact.email ||
                        t.contact.phone
                      : ""}
                  </div>
                </div>
                <div className="text-[11px] text-slate-500">
                  {t.dueDate ? new Date(t.dueDate).toLocaleDateString() : "No due"}
                </div>
              </div>
            ))}
            {overdueTasks.length === 0 && <p className="text-xs text-slate-500">No open tasks.</p>}
          </div>
        </SectionCard>
      </CardGrid>

      <SectionCard
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
          <p className="text-xs text-slate-500">No recent events.</p>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {events.slice(0, 10).map((event) => (
              <div
                key={event.id}
                className="rounded-xl border border-slate-200 bg-white p-2 text-[11px] text-slate-600 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex items-center justify-between text-slate-900">
                  <span className="font-semibold">{event.type}</span>
                  <span className="text-[10px] text-slate-500">{new Date(event.createdAt).toLocaleString()}</span>
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
      </SectionCard>

      <Drawer open={insightsOpen} onClose={() => setInsightsOpen(false)} title="Pipeline insights">
        <div className="space-y-3 p-2">
          <div className="text-xs text-slate-500">Mobile-first snapshot of where to focus.</div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="text-xs uppercase text-slate-500">Total contacts</div>
              <div className="text-lg font-semibold text-slate-900">{totalContacts}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="text-xs uppercase text-slate-500">Upcoming tasks</div>
              <div className="text-lg font-semibold text-slate-900">{tasks.length}</div>
            </div>
          </div>
          <div className="space-y-2">
            {insights.map((item) => (
              <div
                key={item.label}
                className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm"
              >
                <div>
                  <div className="text-sm font-semibold text-slate-900">{item.label}</div>
                  <div className="text-[11px] text-slate-500">{item.hint}</div>
                </div>
                <Badge tone={item.tone}>{item.value}</Badge>
              </div>
            ))}
          </div>
        </div>
      </Drawer>
    </ContentContainer>
  );
}
