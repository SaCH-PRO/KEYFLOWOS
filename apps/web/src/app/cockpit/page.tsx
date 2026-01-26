"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  AchievementCapsule,
  Badge,
  Button,
  Card,
  FlowFeed,
  FlowGraphPlaceholder,
  Input,
  MomentumBar,
  Shell,
} from "@keyflow/ui";
import { Contact, fetchContacts, fetchCrmHighlights, FlowHighlights } from "@/lib/client";
import { ensureWorkspace, getStoredBusinessId } from "@/lib/workspace";

const mockFeed = [
  { id: "1", icon: "💸", text: "Invoice #004 paid — confirming booking…", timestamp: "08:24", tone: "success" as const },
  { id: "2", icon: "🗓️", text: "Booking created for Sarah — 3:00 PM", timestamp: "08:21" },
  { id: "3", icon: "⚡", text: "Automation executed: Review Request Flow", timestamp: "08:18", tone: "info" as const },
];

const emptyHighlights: FlowHighlights = {
  highlights: { highPotential: [], overdueReminders: [], serviceAffinity: [] },
  segments: [],
  timeline: [],
  nextActions: [],
  aiNextActions: [],
};

const toneBySeverity = {
  high: "danger",
  medium: "warning",
  info: "info",
} as const;

const toneByType = (type: string, title: string) => {
  if (type === "invoice" && title.includes("PAID")) return "success" as const;
  if (type === "invoice" && (title.includes("OVERDUE") || title.includes("VOID"))) return "danger" as const;
  if (type === "task") return "warning" as const;
  if (type === "booking") return "info" as const;
  return "default" as const;
};

const iconByType = (type: string) => {
  switch (type) {
    case "invoice":
      return "💸";
    case "booking":
      return "🗓️";
    case "task":
      return "✅";
    case "note":
      return "📝";
    default:
      return "⚡";
  }
};

const formatTime = (value?: string) => {
  if (!value) return "";
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

export default function CockpitPage() {
  const router = useRouter();
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [highlights, setHighlights] = useState<FlowHighlights | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Contact[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  useEffect(() => {
    const initWorkspace = async () => {
      const stored = getStoredBusinessId();
      if (stored) {
        setBusinessId(stored);
        return;
      }
      const created = await ensureWorkspace();
      if (created) setBusinessId(created);
    };
    void initWorkspace();
  }, []);

  useEffect(() => {
    if (!businessId) return;
    setLoading(true);
    fetchCrmHighlights(businessId)
      .then((result) => {
        setHighlights(result.data ?? emptyHighlights);
      })
      .catch(() => {
        setHighlights(emptyHighlights);
      })
      .finally(() => setLoading(false));
  }, [businessId]);

  useEffect(() => {
    if (!businessId) return;
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
      setSearchLoading(true);
      fetchContacts(businessId, { search: query, take: 6, includeStats: true })
        .then((result) => setSearchResults(result.data ?? []))
        .catch(() => setSearchResults([]))
        .finally(() => setSearchLoading(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [businessId, searchQuery]);

  const summary = highlights ?? emptyHighlights;
  const feedItems = useMemo(() => {
    if (!highlights || highlights.timeline.length === 0) return mockFeed;
    return highlights.timeline.slice(0, 6).map((entry) => ({
      id: entry.id,
      icon: iconByType(entry.type),
      text: `${entry.title}${entry.contactName ? ` · ${entry.contactName}` : ""}${
        entry.description ? ` — ${entry.description}` : ""
      }`,
      timestamp: formatTime(entry.timestamp),
      tone: toneByType(entry.type, entry.title),
    }));
  }, [highlights]);

  const integrationStats = useMemo(() => {
    const invoicePaid = summary.timeline.filter((entry) => entry.type === "invoice" && entry.title.includes("PAID")).length;
    const bookingPending = summary.timeline.filter(
      (entry) => entry.type === "booking" && entry.title.includes("PENDING"),
    ).length;
    return {
      invoicePaid,
      bookingPending,
      timelineSignals: summary.timeline.length,
    };
  }, [summary.timeline]);

  return (
    <Shell
      sidebar={
        <div className="p-4 space-y-3 text-sm text-slate-200">
          <div className="uppercase text-xs tracking-[0.08em] text-slate-400 mb-2">Command</div>
          <div className="space-y-1">
            {["Flow Feed", "Live Graph", "Cmd+K", "Automations", "Billing"].map((item) => (
              <div
                key={item}
                className="cursor-pointer rounded-lg px-3 py-2 text-slate-100 hover:bg-[rgba(78,168,255,0.08)] hover:text-[var(--kf-electric)] transition-colors"
              >
                {item}
              </div>
            ))}
          </div>
        </div>
      }
      topbar={<MomentumBar value={0.62} streaks={["Follow-up streak 3d", "7 invoices confirmed"]} />}
    >
      <div className="space-y-4">
        <Card
          title="CRM Command"
          badge={searchLoading ? "Searching..." : `${searchResults.length} results`}
          className="bg-[rgba(0,0,0,0.4)]"
        >
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Search contacts, tags, or segments"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full md:w-80"
            />
            <Button variant="outline" size="sm" onClick={() => setSearchQuery("")}>
              Clear
            </Button>
            <Button variant="secondary" size="sm" className="ml-auto" onClick={() => router.push("/app/crm/dashboard")}>
              Open CRM
            </Button>
          </div>
          {searchQuery.trim() && (
            <div className="mt-3 space-y-2 text-sm">
              {searchResults.length === 0 && !searchLoading && (
                <div className="text-xs text-muted-foreground">No contacts match that query.</div>
              )}
              {searchResults.map((contact) => (
                <Link
                  key={contact.id}
                  href={`/app/crm/contacts/${contact.id}`}
                  className="flex items-center justify-between rounded-lg border border-border/60 bg-slate-950/60 px-3 py-2 hover:border-primary/60"
                >
                  <div>
                    <div className="text-sm font-semibold">
                      {contact.displayName ||
                        `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() ||
                        contact.email ||
                        "Unnamed"}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {contact.email || contact.phone || "No contact info"}
                    </div>
                  </div>
                  <Badge tone="info">Score {contact.meta?.leadScore ?? "-"}</Badge>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-4">
            <FlowGraphPlaceholder />
            <Card title="Next actions" badge={`${summary.nextActions.length} queued`}>
              {summary.nextActions.length === 0 ? (
                <div className="text-xs text-muted-foreground">All clear — no urgent CRM follow-ups.</div>
              ) : (
                <div className="space-y-2 text-sm">
                  {summary.nextActions.slice(0, 6).map((action) => (
                    <div
                      key={action.id}
                      className="rounded-xl border border-border/60 bg-slate-950/50 px-3 py-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className="font-semibold">{action.title}</div>
                        <Badge tone={toneBySeverity[action.severity]}>{action.severity}</Badge>
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {action.contactName ? `${action.contactName} · ` : ""}
                        {action.detail}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
            <Card title="Service affinity" badge={`${summary.highlights.serviceAffinity.length} services`}>
              {summary.highlights.serviceAffinity.length === 0 ? (
                <div className="text-xs text-muted-foreground">No bookings yet to rank services.</div>
              ) : (
                <div className="grid gap-2 md:grid-cols-2">
                  {summary.highlights.serviceAffinity.map((service) => (
                    <div key={service.serviceId} className="rounded-xl border border-border/60 bg-slate-950/50 p-3">
                      <div className="text-sm font-semibold">{service.serviceName}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {service.bookings} bookings · {service.revenue.toLocaleString()} revenue
                      </div>
                      {service.topContact && (
                        <div className="text-[11px] text-muted-foreground mt-1">
                          Top fan: {service.topContact.name} ({service.topContact.bookings})
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
          <div className="space-y-4">
            <FlowFeed items={feedItems} />
            <Card title="High potential spotlight" badge={`${summary.highlights.highPotential.length} contacts`}>
              <div className="space-y-2">
                {summary.highlights.highPotential.slice(0, 4).map((contact) => (
                  <div
                    key={contact.contactId}
                    className="rounded-xl border border-border/60 bg-slate-950/50 px-3 py-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold">{contact.name}</span>
                      <Badge tone="success">Score {contact.leadScore ?? "-"}</Badge>
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {contact.status} · {(contact.tags ?? []).slice(0, 3).join(", ") || "No tags"}
                    </div>
                  </div>
                ))}
                {summary.highlights.highPotential.length === 0 && (
                  <div className="text-xs text-muted-foreground">No high-scoring contacts yet.</div>
                )}
              </div>
            </Card>
            <Card title="Overdue reminders" badge={`${summary.highlights.overdueReminders.length} flagged`}>
              <div className="space-y-2">
                {summary.highlights.overdueReminders.slice(0, 4).map((contact) => (
                  <div
                    key={contact.contactId}
                    className="rounded-xl border border-border/60 bg-slate-950/50 px-3 py-2 text-sm"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{contact.name}</span>
                      <Badge tone="danger">Owed {contact.outstandingBalance?.toFixed(0) ?? 0}</Badge>
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {contact.unpaidInvoices ?? 0} unpaid invoices
                    </div>
                  </div>
                ))}
                {summary.highlights.overdueReminders.length === 0 && (
                  <div className="text-xs text-muted-foreground">No overdue balances detected.</div>
                )}
              </div>
            </Card>
            <Card title="Segment intelligence" badge={`${summary.segments.length} segments`}>
              {summary.segments.length === 0 ? (
                <div className="text-xs text-muted-foreground">Segments will appear once contacts are active.</div>
              ) : (
                <div className="space-y-2">
                  {summary.segments.map((segment) => (
                    <div key={segment.key} className="rounded-xl border border-border/60 bg-slate-950/50 px-3 py-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold">{segment.label}</span>
                        <Badge tone="info">{segment.count}</Badge>
                      </div>
                      <div className="text-[11px] text-muted-foreground">{segment.description}</div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
            <Card title="AI next actions (stub)" badge={`${summary.aiNextActions.length} hooks`}>
              <div className="space-y-2 text-xs text-muted-foreground">
                {summary.aiNextActions.map((stub) => (
                  <div key={stub.id} className="rounded-xl border border-border/60 bg-slate-950/50 px-3 py-2">
                    <div className="font-semibold text-sm text-white">{stub.title}</div>
                    <div>{stub.detail}</div>
                  </div>
                ))}
                {summary.aiNextActions.length === 0 && (
                  <div className="text-xs text-muted-foreground">AI hooks will appear once automation is wired.</div>
                )}
              </div>
            </Card>
            <Card title="Integration cues" badge={loading ? "Syncing" : "Live"}>
              <div className="grid gap-2 text-xs text-muted-foreground">
                <div className="flex items-center justify-between">
                  <span>Invoices paid</span>
                  <Badge tone="success">{integrationStats.invoicePaid}</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span>Bookings pending</span>
                  <Badge tone="warning">{integrationStats.bookingPending}</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span>CRM timeline signals</span>
                  <Badge tone="info">{integrationStats.timelineSignals}</Badge>
                </div>
              </div>
            </Card>
            <Card title="Flow momentum" badge="Achievements">
              <div className="space-y-2">
                <Badge tone="success">First Sale Completed</Badge>
                <Badge tone="info">Automation Executed</Badge>
                <AchievementCapsule
                  title="🔥 Momentum Rising"
                  description="10 bookings this week. Animations speed slightly increased."
                />
              </div>
            </Card>
          </div>
        </div>
      </div>
    </Shell>
  );
}
