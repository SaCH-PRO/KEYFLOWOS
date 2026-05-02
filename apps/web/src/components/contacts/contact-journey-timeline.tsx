"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Calendar,
  DollarSign,
  FileText,
  Mail,
  Star,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Clock,
  Users,
  Zap,
  MessageCircle,
  ChevronDown,
  ChevronUp,
  Circle,
  Package,
  Megaphone,
  UserPlus,
  StickyNote,
  ListTodo,
  ExternalLink,
  TrendingUp,
  Activity,
} from "lucide-react";
import type { ContactDetailData, ContactEvent, ContactNote, ContactTask } from "./contact-detail";
import type { CrossJourneyResponse } from "@/lib/client";

type ModuleFilter = "all" | "crm" | "bookings" | "commerce" | "marketing";

interface JourneyEntry {
  id: string;
  module: ModuleFilter;
  icon: typeof Calendar;
  iconColor: string;
  iconBg: string;
  title: string;
  description?: string;
  timestamp: string;
  value?: number;
  currency?: string;
  status?: string;
  ctaLabel?: string;
  ctaHref?: string;
  entityId?: string;
}

interface InvoiceSummary {
  id: string;
  status: string;
  total?: number | null;
  currency?: string | null;
  dueDate?: string | null;
  issueDate?: string | null;
  createdAt?: string;
  paidAt?: string | null;
}

interface BookingSummary {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  service?: { name: string; price: number } | null;
  contact?: { firstName?: string | null } | null;
}

interface ContactJourneyTimelineProps {
  contact: ContactDetailData;
  events: ContactEvent[];
  notes?: ContactNote[];
  tasks?: ContactTask[];
  invoices?: InvoiceSummary[];
  bookings?: BookingSummary[];
  crossJourney?: CrossJourneyResponse | null;
}

const MODULE_PILLS: { key: ModuleFilter; label: string; icon: typeof Calendar; color: string }[] = [
  { key: "all", label: "All", icon: Circle, color: "text-foreground" },
  { key: "crm", label: "CRM", icon: Users, color: "text-[hsl(var(--kf-accent1))]" },
  { key: "bookings", label: "Bookings", icon: Calendar, color: "text-[hsl(var(--kf-accent2))]" },
  { key: "commerce", label: "Commerce", icon: DollarSign, color: "text-[hsl(var(--kf-success))]" },
  { key: "marketing", label: "Marketing", icon: Megaphone, color: "text-[hsl(var(--kf-info))]" },
];

function classifyEvent(type: string): ModuleFilter {
  if (type.startsWith("invoice.") || type.startsWith("quote.") || type.startsWith("payment.")) return "commerce";
  if (type.startsWith("booking.")) return "bookings";
  if (type.startsWith("campaign.") || type.startsWith("email.") || type.startsWith("lead_form.") || type.startsWith("form.")) return "marketing";
  return "crm";
}

const EVENT_CONFIG: Record<string, { icon: typeof Calendar; color: string; bg: string; label: string }> = {
  "contact.created": { icon: UserPlus, color: "hsl(var(--kf-accent1))", bg: "hsl(var(--kf-accent1) / 0.15)", label: "Contact created" },
  "status.changed": { icon: Sparkles, color: "hsl(var(--kf-accent2))", bg: "hsl(var(--kf-accent2) / 0.15)", label: "Status changed" },
  "STATUS_CHANGED": { icon: Sparkles, color: "hsl(var(--kf-accent2))", bg: "hsl(var(--kf-accent2) / 0.15)", label: "Status changed" },
  "note.created": { icon: StickyNote, color: "hsl(var(--kf-accent1))", bg: "hsl(var(--kf-accent1) / 0.15)", label: "Note added" },
  "note.updated": { icon: StickyNote, color: "hsl(var(--kf-accent1))", bg: "hsl(var(--kf-accent1) / 0.15)", label: "Note updated" },
  "task.created": { icon: ListTodo, color: "hsl(var(--kf-accent1))", bg: "hsl(var(--kf-accent1) / 0.15)", label: "Task created" },
  "task.completed": { icon: CheckCircle2, color: "hsl(var(--kf-success))", bg: "hsl(var(--kf-success) / 0.15)", label: "Task completed" },
  "invoice.created": { icon: FileText, color: "hsl(var(--kf-info))", bg: "hsl(var(--kf-info) / 0.15)", label: "Invoice created" },
  "invoice.sent": { icon: Mail, color: "hsl(var(--kf-info))", bg: "hsl(var(--kf-info) / 0.15)", label: "Invoice sent" },
  "invoice.paid": { icon: DollarSign, color: "hsl(var(--kf-success))", bg: "hsl(var(--kf-success) / 0.15)", label: "Payment received" },
  "invoice.overdue": { icon: AlertTriangle, color: "hsl(var(--kf-error))", bg: "hsl(var(--kf-error) / 0.15)", label: "Invoice overdue" },
  "booking.created": { icon: Calendar, color: "hsl(var(--kf-accent2))", bg: "hsl(var(--kf-accent2) / 0.15)", label: "Booking scheduled" },
  "booking.confirmed": { icon: CheckCircle2, color: "hsl(var(--kf-success))", bg: "hsl(var(--kf-success) / 0.15)", label: "Booking confirmed" },
  "booking.completed": { icon: Star, color: "hsl(var(--kf-warning))", bg: "hsl(var(--kf-warning) / 0.15)", label: "Service completed" },
  "booking.cancelled": { icon: AlertTriangle, color: "hsl(var(--kf-error))", bg: "hsl(var(--kf-error) / 0.15)", label: "Booking cancelled" },
  "quote.created": { icon: FileText, color: "hsl(var(--kf-info))", bg: "hsl(var(--kf-info) / 0.15)", label: "Quote sent" },
  "quote.accepted": { icon: CheckCircle2, color: "hsl(var(--kf-success))", bg: "hsl(var(--kf-success) / 0.15)", label: "Quote accepted" },
  "quote.rejected": { icon: AlertTriangle, color: "hsl(var(--kf-error))", bg: "hsl(var(--kf-error) / 0.15)", label: "Quote rejected" },
  "campaign.sent": { icon: Megaphone, color: "hsl(var(--kf-info))", bg: "hsl(var(--kf-info) / 0.15)", label: "Campaign sent" },
  "campaign.opened": { icon: Mail, color: "hsl(var(--kf-success))", bg: "hsl(var(--kf-success) / 0.15)", label: "Campaign opened" },
  "lead_form.submitted": { icon: FileText, color: "hsl(var(--kf-accent2))", bg: "hsl(var(--kf-accent2) / 0.15)", label: "Form submitted" },
  "email.sent": { icon: Mail, color: "hsl(var(--kf-info))", bg: "hsl(var(--kf-info) / 0.15)", label: "Email sent" },
  "whatsapp.sent": { icon: MessageCircle, color: "hsl(var(--kf-success))", bg: "hsl(var(--kf-success) / 0.15)", label: "WhatsApp sent" },
  "automation.executed": { icon: Zap, color: "hsl(var(--kf-accent2))", bg: "hsl(var(--kf-accent2) / 0.15)", label: "Automation ran" },
  "communication.call": { icon: MessageCircle, color: "hsl(var(--kf-accent1))", bg: "hsl(var(--kf-accent1) / 0.15)", label: "Call logged" },
  "communication.email": { icon: Mail, color: "hsl(var(--kf-accent1))", bg: "hsl(var(--kf-accent1) / 0.15)", label: "Email logged" },
  "communication.whatsapp": { icon: MessageCircle, color: "hsl(var(--kf-success))", bg: "hsl(var(--kf-success) / 0.15)", label: "WhatsApp logged" },
  "communication.meeting": { icon: Users, color: "hsl(var(--kf-accent2))", bg: "hsl(var(--kf-accent2) / 0.15)", label: "Meeting logged" },
};

const DEFAULT_CONFIG = { icon: Circle, color: "hsl(var(--kf-muted-foreground))", bg: "hsl(var(--kf-muted-foreground) / 0.1)", label: "" };

function getModuleLabel(module: ModuleFilter): string {
  switch (module) {
    case "crm": return "CRM";
    case "bookings": return "Bookings";
    case "commerce": return "Commerce";
    case "marketing": return "Marketing";
    default: return "";
  }
}

function formatAmount(amount: number, currency = "TTD"): string {
  return `${currency} ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function computeMomentumScore(
  eventsCount: number,
  bookingsCount: number,
  paidRevenue: number,
  daysSinceLastInteraction: number,
): number {
  const activityScore = Math.min(40, eventsCount * 4);
  const bookingScore = Math.min(20, bookingsCount * 10);
  const revenueScore = paidRevenue > 0 ? Math.min(20, Math.log10(paidRevenue + 1) * 5) : 0;
  const recencyScore = daysSinceLastInteraction <= 7 ? 20 : daysSinceLastInteraction <= 30 ? 10 : daysSinceLastInteraction <= 90 ? 5 : 0;
  return Math.round(Math.min(100, activityScore + bookingScore + revenueScore + recencyScore));
}

const CTA_HREF_MAP: Record<string, (entityId?: string) => string> = {
  commerce: (id) => id ? `/app/commerce?tab=invoices&id=${encodeURIComponent(id)}` : "/app/commerce?tab=invoices",
  bookings: (id) => id ? `/app/bookings?id=${encodeURIComponent(id)}` : "/app/bookings",
  marketing: (id) => id ? `/app/marketing?tab=calendar&id=${encodeURIComponent(id)}` : "/app/marketing?tab=calendar",
};

function serverTimelineToEntries(timeline: CrossJourneyResponse["timeline"]): JourneyEntry[] {
  return timeline.map((item) => {
    const config = EVENT_CONFIG[item.type] || DEFAULT_CONFIG;
    const mod = (item.module === "crm" || item.module === "bookings" || item.module === "commerce" || item.module === "marketing") ? item.module : "crm";
    const hrefFn = item.ctaModule ? CTA_HREF_MAP[item.ctaModule] : undefined;
    return {
      id: item.id,
      module: mod as ModuleFilter,
      icon: config.icon,
      iconColor: config.color,
      iconBg: config.bg,
      title: item.title,
      description: item.description,
      timestamp: item.timestamp,
      value: item.value,
      currency: item.currency,
      status: item.status,
      ctaLabel: item.ctaLabel,
      ctaHref: hrefFn ? hrefFn(item.entityId) : undefined,
      entityId: item.entityId,
    };
  });
}

export function ContactJourneyTimeline({ contact, events, notes = [], tasks = [], invoices = [], bookings = [], crossJourney }: ContactJourneyTimelineProps) {
  const [filter, setFilter] = useState<ModuleFilter>("all");
  const [limit, setLimit] = useState(25);

  const entries = useMemo(() => {
    if (crossJourney?.timeline) {
      return serverTimelineToEntries(crossJourney.timeline);
    }

    const items: JourneyEntry[] = [];

    for (const ev of events) {
      const config = EVENT_CONFIG[ev.type] || DEFAULT_CONFIG;
      const moduleName = classifyEvent(ev.type);

      const data = ev.data as Record<string, unknown> | null | undefined;

      let description: string | undefined;
      if (ev.type === "status.changed" && data?.from && data?.to) {
        description = `${data.from} → ${data.to}`;
      } else if (ev.type === "invoice.paid" && data?.amount) {
        description = `Amount: ${formatAmount(Number(data.amount), (data.currency as string) || "TTD")}`;
      }

      let ctaLabel: string | undefined;
      let ctaHref: string | undefined;
      if (ev.type.startsWith("invoice.") && data?.invoiceId) {
        ctaLabel = "View Invoice";
        ctaHref = `/app/commerce?tab=invoices&id=${encodeURIComponent(String(data.invoiceId))}`;
      } else if (ev.type.startsWith("booking.") && data?.bookingId) {
        ctaLabel = "View Booking";
        ctaHref = `/app/bookings?id=${encodeURIComponent(String(data.bookingId))}`;
      } else if (ev.type.startsWith("campaign.") && data?.campaignId) {
        ctaLabel = "View Campaign";
        ctaHref = `/app/marketing?tab=calendar&id=${encodeURIComponent(String(data.campaignId))}`;
      }

      items.push({
        id: ev.id,
        module: moduleName,
        icon: config.icon,
        iconColor: config.color,
        iconBg: config.bg,
        title: config.label || ev.type,
        description,
        timestamp: ev.createdAt,
        value: typeof data?.amount === "number" ? data.amount : undefined,
        currency: typeof data?.currency === "string" ? data.currency : undefined,
        ctaLabel,
        ctaHref,
        entityId: typeof data?.invoiceId === "string" ? data.invoiceId : typeof data?.bookingId === "string" ? data.bookingId : undefined,
      });
    }

    const noteEventIds = new Set(
      events.filter((e) => e.type === "note.created" || e.type === "note.updated").map((e) => {

        const d = e.data as Record<string, unknown> | null | undefined;
        return typeof d?.noteId === "string" ? d.noteId : "";
      }).filter(Boolean),
    );
    for (const note of notes) {
      if (noteEventIds.has(note.id)) continue;
      items.push({
        id: `note-${note.id}`,
        module: "crm",
        icon: StickyNote,
        iconColor: "hsl(var(--kf-accent1))",
        iconBg: "hsl(var(--kf-accent1) / 0.15)",
        title: "Note added",
        description: note.body.length > 80 ? note.body.slice(0, 80) + "…" : note.body,
        timestamp: note.createdAt,
      });
    }

    const taskEventIds = new Set<string>();
    const taskEventTitles = new Set<string>();
    for (const e of events) {
      if (e.type === "task.created" || e.type === "task.completed") {

        const d = e.data as Record<string, unknown> | null | undefined;
        if (typeof d?.taskId === "string") taskEventIds.add(d.taskId);
        if (typeof d?.title === "string") taskEventTitles.add(d.title);
      }
    }
    for (const task of tasks) {
      if (taskEventIds.has(task.id) || taskEventTitles.has(task.title)) continue;
      const isCompleted = task.status === "DONE";
      items.push({
        id: `task-${task.id}`,
        module: "crm",
        icon: isCompleted ? CheckCircle2 : ListTodo,
        iconColor: isCompleted ? "hsl(var(--kf-success))" : "hsl(var(--kf-accent1))",
        iconBg: isCompleted ? "hsl(var(--kf-success) / 0.15)" : "hsl(var(--kf-accent1) / 0.15)",
        title: isCompleted ? "Task completed" : "Task created",
        description: task.title,
        timestamp: (isCompleted ? task.completedAt : task.createdAt) || task.createdAt || new Date().toISOString(),
      });
    }

    for (const inv of invoices) {
      const alreadyTracked = events.some(

        (e) => e.type.startsWith("invoice.") && (e.data as Record<string, unknown>)?.invoiceId === inv.id,
      );
      if (alreadyTracked) continue;

      const total = typeof inv.total === "number" ? inv.total : 0;
      const isPaid = inv.status === "PAID";
      const isOverdue = inv.status === "OVERDUE";

      items.push({
        id: `inv-${inv.id}`,
        module: "commerce",
        icon: isPaid ? DollarSign : isOverdue ? AlertTriangle : FileText,
        iconColor: isPaid ? "hsl(var(--kf-success))" : isOverdue ? "hsl(var(--kf-error))" : "hsl(var(--kf-info))",
        iconBg: isPaid ? "hsl(var(--kf-success) / 0.15)" : isOverdue ? "hsl(var(--kf-error) / 0.15)" : "hsl(var(--kf-info) / 0.15)",
        title: isPaid ? "Payment received" : isOverdue ? "Invoice overdue" : `Invoice ${inv.status.toLowerCase()}`,
        description: total > 0 ? formatAmount(total, inv.currency || "TTD") : undefined,
        timestamp: inv.paidAt || inv.issueDate || inv.createdAt || new Date().toISOString(),
        value: total,
        currency: inv.currency || "TTD",
        status: inv.status,
        ctaLabel: "View Invoice",
        ctaHref: `/app/commerce?tab=invoices&id=${encodeURIComponent(inv.id)}`,
        entityId: inv.id,
      });
    }

    for (const bk of bookings) {
      const alreadyTracked = events.some(

        (e) => e.type.startsWith("booking.") && (e.data as Record<string, unknown>)?.bookingId === bk.id,
      );
      if (alreadyTracked) continue;

      const isCompleted = bk.status === "COMPLETED";
      const isCancelled = bk.status === "CANCELLED";

      items.push({
        id: `bk-${bk.id}`,
        module: "bookings",
        icon: isCompleted ? Star : isCancelled ? AlertTriangle : Calendar,
        iconColor: isCompleted ? "hsl(var(--kf-warning))" : isCancelled ? "hsl(var(--kf-error))" : "hsl(var(--kf-accent2))",
        iconBg: isCompleted ? "hsl(var(--kf-warning) / 0.15)" : isCancelled ? "hsl(var(--kf-error) / 0.15)" : "hsl(var(--kf-accent2) / 0.15)",
        title: isCompleted ? "Service completed" : isCancelled ? "Booking cancelled" : "Appointment scheduled",
        description: bk.service?.name || undefined,
        timestamp: bk.startTime,
        value: bk.service?.price,
        currency: "TTD",
        status: bk.status,
        ctaLabel: "View Booking",
        ctaHref: `/app/bookings?id=${encodeURIComponent(bk.id)}`,
        entityId: bk.id,
      });
    }

    items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return items;
  }, [crossJourney, events, notes, tasks, invoices, bookings]);

  const filtered = useMemo(
    () => (filter === "all" ? entries : entries.filter((e) => e.module === filter)),
    [entries, filter],
  );

  const moduleCounts = useMemo(() => {
    const counts: Record<ModuleFilter, number> = { all: entries.length, crm: 0, bookings: 0, commerce: 0, marketing: 0 };
    for (const e of entries) counts[e.module]++;
    return counts;
  }, [entries]);

  const summary = useMemo(() => {
    if (crossJourney?.summary) {
      const s = crossJourney.summary;
      const lastTs = s.lastInteractionAt ? new Date(s.lastInteractionAt).getTime() : null;
      // eslint-disable-next-line react-hooks/purity -- audited: time-relative days-since computation
      const daysSince = lastTs ? Math.floor((Date.now() - lastTs) / (1000 * 60 * 60 * 24)) : 999;
      return {
        totalRevenue: s.totalRevenue,
        bookingsCount: s.bookingsCount,
        lastInteractionTs: lastTs,
        momentum: s.momentum,
        engagementLevel: s.engagementLevel as "high" | "medium" | "low",
        daysSinceLastInteraction: daysSince,
      };
    }
    const paidInvoiceRevenue = invoices
      .filter((inv) => inv.status === "PAID")
      .reduce((sum, inv) => sum + (typeof inv.total === "number" ? inv.total : 0), 0);
    const bookingsCount = bookings.length;
    const allTimestamps = entries.map((e) => new Date(e.timestamp).getTime()).filter((t) => !Number.isNaN(t));
    const lastInteractionTs = allTimestamps.length > 0 ? Math.max(...allTimestamps) : null;
    const daysSinceLastInteraction = lastInteractionTs
      // eslint-disable-next-line react-hooks/purity -- audited: time-relative days-since computation
      ? Math.floor((Date.now() - lastInteractionTs) / (1000 * 60 * 60 * 24))
      : 999;
    const momentum = computeMomentumScore(events.length, bookingsCount, paidInvoiceRevenue, daysSinceLastInteraction);
    const engLevel: "high" | "medium" | "low" = events.length >= 10 ? "high" : events.length >= 3 ? "medium" : "low";
    return { totalRevenue: paidInvoiceRevenue, bookingsCount, lastInteractionTs, momentum, engagementLevel: engLevel, daysSinceLastInteraction };
  }, [crossJourney, entries, events.length, invoices, bookings.length]);

  const contactFirstName = contact.firstName || "Contact";

  const dateGroups = useMemo(() => {
    const groups: { label: string; entries: JourneyEntry[] }[] = [];
    const visible = filtered.slice(0, limit);
    let currentLabel = "";

    for (const entry of visible) {
      const d = new Date(entry.timestamp);
      const now = new Date();
      const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
      let label: string;
      if (diffDays === 0) label = "Today";
      else if (diffDays === 1) label = "Yesterday";
      else if (diffDays < 7) label = "This Week";
      else if (diffDays < 30) label = "This Month";
      else if (diffDays < 90) label = "Last 3 Months";
      else label = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });

      if (label !== currentLabel) {
        groups.push({ label, entries: [] });
        currentLabel = label;
      }
      groups[groups.length - 1].entries.push(entry);
    }
    return groups;
  }, [filtered, limit]);

  if (entries.length === 0) {
    return (
      <div className="text-center py-8 space-y-2">
        <div className="mx-auto w-12 h-12 rounded-full bg-muted/30 flex items-center justify-center">
          <Clock className="w-6 h-6 text-muted-foreground/40" />
        </div>
        <p className="text-sm text-muted-foreground">No journey events yet</p>
        <p className="text-xs text-muted-foreground/60">
          Events from bookings, invoices, and campaigns will appear here as {contactFirstName}&apos;s journey unfolds
        </p>
      </div>
    );
  }

  const momentumColor = summary.momentum >= 70
    ? "text-[hsl(var(--kf-success))]"
    : summary.momentum >= 40
    ? "text-[hsl(var(--kf-warning))]"
    : "text-[hsl(var(--kf-error))]";

  const momentumBg = summary.momentum >= 70
    ? "bg-[hsl(var(--kf-success))]/10"
    : summary.momentum >= 40
    ? "bg-[hsl(var(--kf-warning))]/10"
    : "bg-[hsl(var(--kf-error))]/10";

  const engagementColor = summary.engagementLevel === "high"
    ? "text-[hsl(var(--kf-success))]"
    : summary.engagementLevel === "medium"
    ? "text-[hsl(var(--kf-warning))]"
    : "text-[hsl(var(--kf-error))]";

  const engagementLabel = summary.engagementLevel === "high" ? "High" : summary.engagementLevel === "medium" ? "Medium" : "Low";

  return (
    <div className="space-y-3 px-1">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground mr-1">
          <Package className="w-3.5 h-3.5" />
          Cross-Module
        </div>
        {MODULE_PILLS.map((pill) => (
          <button
            key={pill.key}
            onClick={() => setFilter(pill.key)}
            className={`text-[10px] px-2 py-1 rounded-md transition-colors flex items-center gap-1 ${
              filter === pill.key
                ? "bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))]"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            <pill.icon className="w-3 h-3" />
            {pill.label}
            {moduleCounts[pill.key] > 0 && (
              <span className="text-[9px] opacity-70">({moduleCounts[pill.key]})</span>
            )}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-muted/30 border border-border/50 p-2.5">
          <div className="flex items-center gap-1.5 mb-1">
            <Calendar className="w-3 h-3 text-[hsl(var(--kf-accent2))]" />
            <span className="text-[10px] text-muted-foreground">Bookings</span>
          </div>
          <div className="text-sm font-semibold">{summary.bookingsCount}</div>
        </div>
        <div className="rounded-lg bg-muted/30 border border-border/50 p-2.5">
          <div className="flex items-center gap-1.5 mb-1">
            <DollarSign className="w-3 h-3 text-[hsl(var(--kf-success))]" />
            <span className="text-[10px] text-muted-foreground">Revenue</span>
          </div>
          <div className="text-sm font-semibold">
            {summary.totalRevenue > 0 ? formatAmount(summary.totalRevenue) : "—"}
          </div>
        </div>
        <div className="rounded-lg bg-muted/30 border border-border/50 p-2.5">
          <div className="flex items-center gap-1.5 mb-1">
            <Clock className="w-3 h-3 text-[hsl(var(--kf-info))]" />
            <span className="text-[10px] text-muted-foreground">Last Interaction</span>
          </div>
          <div className="text-sm font-semibold">
            {summary.lastInteractionTs
              ? summary.daysSinceLastInteraction === 0
                ? "Today"
                : summary.daysSinceLastInteraction === 1
                ? "Yesterday"
                : `${summary.daysSinceLastInteraction}d ago`
              : "—"}
          </div>
        </div>
        <div className={`rounded-lg border border-border/50 p-2.5 ${momentumBg}`}>
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingUp className="w-3 h-3" />
            <span className="text-[10px] text-muted-foreground">Momentum</span>
          </div>
          <div className={`text-sm font-semibold ${momentumColor}`}>
            {summary.momentum}/100
          </div>
        </div>
        <div className="rounded-lg bg-muted/30 border border-border/50 p-2.5 col-span-2">
          <div className="flex items-center gap-1.5 mb-1">
            <Activity className="w-3 h-3 text-[hsl(var(--kf-accent1))]" />
            <span className="text-[10px] text-muted-foreground">Engagement</span>
          </div>
          <div className={`text-sm font-semibold ${engagementColor}`}>
            {engagementLabel}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {dateGroups.map((group) => (
          <div key={group.label}>
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 pl-1">
              {group.label}
            </div>
            <div className="relative pl-5 space-y-2">
              <div className="absolute left-[7px] top-1 bottom-1 w-0.5 bg-gradient-to-b from-[hsl(var(--kf-accent1))] via-[hsl(var(--kf-accent2))] to-muted/30" />
              {group.entries.map((entry, idx) => {
                const EntryIcon = entry.icon;
                return (
                  <motion.div
                    key={entry.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.02, duration: 0.2 }}
                    className="relative flex gap-2.5 group"
                  >
                    <div
                      className="absolute left-[-14px] p-1 rounded-full bg-background border-2 z-10"
                      style={{ borderColor: entry.iconColor }}
                    >
                      <EntryIcon className="w-2.5 h-2.5" style={{ color: entry.iconColor }} />
                    </div>
                    <div className="flex-1 ml-2 p-2 rounded-xl bg-muted/20 border border-border/40 hover:border-border/60 transition-colors">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-xs font-medium truncate">{entry.title}</span>
                          <span
                            className="text-[9px] px-1.5 py-0.5 rounded-full whitespace-nowrap"
                            style={{ background: entry.iconBg, color: entry.iconColor }}
                          >
                            {getModuleLabel(entry.module)}
                          </span>
                        </div>
                        <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">
                          {new Date(entry.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </span>
                      </div>
                      {entry.description && (
                        <p className="text-[11px] text-muted-foreground mt-0.5">{entry.description}</p>
                      )}
                      {entry.value != null && entry.value > 0 && !entry.description?.includes("TTD") && (
                        <p className="text-[11px] font-medium mt-0.5" style={{ color: entry.iconColor }}>
                          {formatAmount(entry.value, entry.currency)}
                        </p>
                      )}
                      {entry.ctaLabel && entry.ctaHref && (
                        <a
                          href={entry.ctaHref}
                          className="inline-flex items-center gap-1 text-[10px] font-medium mt-1.5 px-2 py-0.5 rounded-md bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/20 transition-colors"
                        >
                          <ExternalLink className="w-2.5 h-2.5" />
                          {entry.ctaLabel}
                        </a>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {filtered.length > limit && (
        <button
          onClick={() => setLimit((p) => p + 25)}
          className="w-full text-center text-xs text-muted-foreground hover:text-foreground py-2 flex items-center justify-center gap-1 transition-colors"
        >
          <ChevronDown className="w-3 h-3" />
          Show more ({filtered.length - limit} remaining)
        </button>
      )}
      {limit > 25 && (
        <button
          onClick={() => setLimit(25)}
          className="w-full text-center text-xs text-muted-foreground hover:text-foreground py-1 flex items-center justify-center gap-1 transition-colors"
        >
          <ChevronUp className="w-3 h-3" />
          Show less
        </button>
      )}
    </div>
  );
}
