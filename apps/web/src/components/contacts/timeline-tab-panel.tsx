"use client";

import { useMemo, useState } from "react";
import { useCompose } from "@/components/email/compose-context";
import { motion } from "framer-motion";
import {
  MessageSquare,
  ListTodo,
  History,
  Copy,
  MessageCircle,
  Mail,
  StickyNote,
  AlertCircle,
  Check,
  Clock,
  ChevronDown,
  ChevronUp,
  Circle,
  Sparkles,
  Heart,
  Brain,
  Zap,
  Target,
  RefreshCw,
  Calendar,
  DollarSign,
  TrendingUp,
  Activity,
  Users,
  Megaphone,
  Package,
  ExternalLink,
  Filter,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Star,
  UserPlus,
} from "lucide-react";
import { buildWhatsAppLink, getContactPhone } from "@/lib/whatsapp";
import type { ContactDetailData, ContactEvent, ContactNote, ContactTask } from "./contact-detail";
import type { CrossJourneyResponse } from "@/lib/client";
import {
  EVENT_LABELS,
  HEALTH_METRICS_CONFIG,
  type HealthMetricsData,
  type ConversationContextData,
  type AiInsightData,
  type JourneyMilestoneData,
} from "./tab-constants";

type ModuleFilter = "all" | "crm" | "bookings" | "commerce" | "marketing" | "notes" | "tasks";

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

interface UnifiedEntry {
  id: string;
  module: ModuleFilter;
  kind: "event" | "note" | "task" | "invoice" | "booking";
  icon: typeof Calendar;
  iconColor: string;
  iconBg: string;
  title: string;
  description?: string;
  timestamp: string;
  value?: number;
  currency?: string;
  ctaLabel?: string;
  ctaHref?: string;
  rawType?: string;
}

interface TimelineTabPanelProps {
  contact: ContactDetailData;
  events: ContactEvent[];
  notes?: ContactNote[];
  tasks?: ContactTask[];
  invoices?: InvoiceSummary[];
  bookings?: BookingSummary[];
  crossJourney?: CrossJourneyResponse | null;
  healthMetrics?: HealthMetricsData | null;
  journeyMilestones?: JourneyMilestoneData[];
  conversationContext?: ConversationContextData | null;
  aiInsight?: AiInsightData | null;
  aiInsightLoading?: boolean;
  onGenerateAiInsight?: () => Promise<void>;
  onRefreshConversationContext?: () => Promise<void>;
  onAddNote?: (body: string, source?: string) => Promise<void>;
  onAddTask?: (title: string, options?: { dueDate?: string; priority?: string; remindAt?: string }) => Promise<void>;
}

const MODULE_PILLS: { key: ModuleFilter; label: string; icon: typeof Calendar }[] = [
  { key: "all", label: "All", icon: Filter },
  { key: "crm", label: "CRM", icon: Users },
  { key: "bookings", label: "Bookings", icon: Calendar },
  { key: "commerce", label: "Commerce", icon: DollarSign },
  { key: "marketing", label: "Marketing", icon: Megaphone },
  { key: "notes", label: "Notes", icon: StickyNote },
  { key: "tasks", label: "Tasks", icon: ListTodo },
];

const EVENT_CONFIG: Record<string, { icon: typeof Calendar; color: string; bg: string; label: string; module: ModuleFilter }> = {
  "contact.created": { icon: UserPlus, color: "hsl(var(--kf-accent1))", bg: "hsl(var(--kf-accent1) / 0.15)", label: "Contact created", module: "crm" },
  "status.changed": { icon: Sparkles, color: "hsl(var(--kf-accent2))", bg: "hsl(var(--kf-accent2) / 0.15)", label: "Status changed", module: "crm" },
  "STATUS_CHANGED": { icon: Sparkles, color: "hsl(var(--kf-accent2))", bg: "hsl(var(--kf-accent2) / 0.15)", label: "Status changed", module: "crm" },
  "note.created": { icon: StickyNote, color: "hsl(var(--kf-accent1))", bg: "hsl(var(--kf-accent1) / 0.15)", label: "Note added", module: "notes" },
  "note.added": { icon: StickyNote, color: "hsl(var(--kf-accent1))", bg: "hsl(var(--kf-accent1) / 0.15)", label: "Note added", module: "notes" },
  "note.updated": { icon: StickyNote, color: "hsl(var(--kf-accent1))", bg: "hsl(var(--kf-accent1) / 0.15)", label: "Note updated", module: "notes" },
  "task.created": { icon: ListTodo, color: "hsl(var(--kf-accent1))", bg: "hsl(var(--kf-accent1) / 0.15)", label: "Task created", module: "tasks" },
  "task.completed": { icon: CheckCircle2, color: "hsl(var(--kf-success))", bg: "hsl(var(--kf-success) / 0.15)", label: "Task completed", module: "tasks" },
  "invoice.created": { icon: FileText, color: "hsl(var(--kf-info))", bg: "hsl(var(--kf-info) / 0.15)", label: "Invoice created", module: "commerce" },
  "invoice.sent": { icon: Mail, color: "hsl(var(--kf-info))", bg: "hsl(var(--kf-info) / 0.15)", label: "Invoice sent", module: "commerce" },
  "invoice.paid": { icon: DollarSign, color: "hsl(var(--kf-success))", bg: "hsl(var(--kf-success) / 0.15)", label: "Payment received", module: "commerce" },
  "invoice.overdue": { icon: AlertTriangle, color: "hsl(var(--kf-error))", bg: "hsl(var(--kf-error) / 0.15)", label: "Invoice overdue", module: "commerce" },
  "booking.created": { icon: Calendar, color: "hsl(var(--kf-accent2))", bg: "hsl(var(--kf-accent2) / 0.15)", label: "Booking scheduled", module: "bookings" },
  "booking.confirmed": { icon: CheckCircle2, color: "hsl(var(--kf-success))", bg: "hsl(var(--kf-success) / 0.15)", label: "Booking confirmed", module: "bookings" },
  "booking.completed": { icon: Star, color: "hsl(var(--kf-warning))", bg: "hsl(var(--kf-warning) / 0.15)", label: "Service completed", module: "bookings" },
  "booking.cancelled": { icon: AlertTriangle, color: "hsl(var(--kf-error))", bg: "hsl(var(--kf-error) / 0.15)", label: "Booking cancelled", module: "bookings" },
  "quote.created": { icon: FileText, color: "hsl(var(--kf-info))", bg: "hsl(var(--kf-info) / 0.15)", label: "Quote sent", module: "commerce" },
  "quote.accepted": { icon: CheckCircle2, color: "hsl(var(--kf-success))", bg: "hsl(var(--kf-success) / 0.15)", label: "Quote accepted", module: "commerce" },
  "quote.rejected": { icon: AlertTriangle, color: "hsl(var(--kf-error))", bg: "hsl(var(--kf-error) / 0.15)", label: "Quote rejected", module: "commerce" },
  "campaign.sent": { icon: Megaphone, color: "hsl(var(--kf-info))", bg: "hsl(var(--kf-info) / 0.15)", label: "Campaign sent", module: "marketing" },
  "campaign.opened": { icon: Mail, color: "hsl(var(--kf-success))", bg: "hsl(var(--kf-success) / 0.15)", label: "Campaign opened", module: "marketing" },
  "lead_form.submitted": { icon: FileText, color: "hsl(var(--kf-accent2))", bg: "hsl(var(--kf-accent2) / 0.15)", label: "Form submitted", module: "marketing" },
  "form.submitted": { icon: FileText, color: "hsl(var(--kf-accent2))", bg: "hsl(var(--kf-accent2) / 0.15)", label: "Form submitted", module: "marketing" },
  "email.sent": { icon: Mail, color: "hsl(var(--kf-info))", bg: "hsl(var(--kf-info) / 0.15)", label: "Email sent", module: "marketing" },
  "whatsapp.sent": { icon: MessageCircle, color: "hsl(var(--kf-success))", bg: "hsl(var(--kf-success) / 0.15)", label: "WhatsApp sent", module: "crm" },
  "automation.executed": { icon: Zap, color: "hsl(var(--kf-accent2))", bg: "hsl(var(--kf-accent2) / 0.15)", label: "Automation ran", module: "crm" },
  "automation.run": { icon: Zap, color: "hsl(var(--kf-accent2))", bg: "hsl(var(--kf-accent2) / 0.15)", label: "Automation ran", module: "crm" },
  "communication.call": { icon: MessageCircle, color: "hsl(var(--kf-accent1))", bg: "hsl(var(--kf-accent1) / 0.15)", label: "Call logged", module: "crm" },
  "communication.email": { icon: Mail, color: "hsl(var(--kf-accent1))", bg: "hsl(var(--kf-accent1) / 0.15)", label: "Email logged", module: "crm" },
  "communication.whatsapp": { icon: MessageCircle, color: "hsl(var(--kf-success))", bg: "hsl(var(--kf-success) / 0.15)", label: "WhatsApp logged", module: "crm" },
  "communication.meeting": { icon: Users, color: "hsl(var(--kf-accent2))", bg: "hsl(var(--kf-accent2) / 0.15)", label: "Meeting logged", module: "crm" },
};

const DEFAULT_CONFIG = { icon: Circle, color: "hsl(var(--kf-muted-foreground))", bg: "hsl(var(--kf-muted-foreground) / 0.1)", label: "", module: "crm" as ModuleFilter };

function classifyEvent(type: string): ModuleFilter {
  if (type.startsWith("invoice.") || type.startsWith("quote.") || type.startsWith("payment.")) return "commerce";
  if (type.startsWith("booking.")) return "bookings";
  if (type.startsWith("campaign.") || type.startsWith("email.") || type.startsWith("lead_form.") || type.startsWith("form.")) return "marketing";
  if (type.startsWith("note.")) return "notes";
  if (type.startsWith("task.")) return "tasks";
  return "crm";
}

function formatAmount(amount: number, currency = "TTD"): string {
  return `${currency} ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getModuleLabel(m: ModuleFilter): string {
  switch (m) {
    case "crm": return "CRM";
    case "bookings": return "Bookings";
    case "commerce": return "Commerce";
    case "marketing": return "Marketing";
    case "notes": return "Note";
    case "tasks": return "Task";
    default: return "";
  }
}

const CTA_HREF_MAP: Record<string, (id?: string) => string> = {
  commerce: (id) => id ? `/app/commerce?tab=invoices&id=${encodeURIComponent(id)}` : "/app/commerce?tab=invoices",
  bookings: (id) => id ? `/app/bookings?id=${encodeURIComponent(id)}` : "/app/bookings",
  marketing: (id) => id ? `/app/marketing?tab=calendar&id=${encodeURIComponent(id)}` : "/app/marketing?tab=calendar",
};

function computeMomentumScore(eventsCount: number, bookingsCount: number, paidRevenue: number, daysSinceLastInteraction: number): number {
  const a = Math.min(40, eventsCount * 4);
  const b = Math.min(20, bookingsCount * 10);
  const r = paidRevenue > 0 ? Math.min(20, Math.log10(paidRevenue + 1) * 5) : 0;
  const rec = daysSinceLastInteraction <= 7 ? 20 : daysSinceLastInteraction <= 30 ? 10 : daysSinceLastInteraction <= 90 ? 5 : 0;
  return Math.round(Math.min(100, a + b + r + rec));
}

export function TimelineTabPanel({
  contact, events, notes = [], tasks = [], invoices = [], bookings = [],
  crossJourney,
  healthMetrics, journeyMilestones: _journeyMilestones,
  conversationContext, aiInsight, aiInsightLoading,
  onGenerateAiInsight, onRefreshConversationContext,
  onAddNote, onAddTask,
}: TimelineTabPanelProps) {
  void _journeyMilestones;
  const compose = useCompose();
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState<ModuleFilter>("all");
  const [limit, setLimit] = useState(25);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [aiCopied, setAiCopied] = useState(false);

  const waPhone = getContactPhone(contact);

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleCopyAi = (text: string) => {
    navigator.clipboard.writeText(text);
    setAiCopied(true);
    setTimeout(() => setAiCopied(false), 2000);
  };

  const handleCreateNoteFrom = async (label: string) => {
    if (!onAddNote) return;
    await onAddNote(`Event: ${label}`, "general");
  };

  const handleCreateTaskFrom = async (label: string) => {
    if (!onAddTask) return;
    await onAddTask(`Follow up on: ${label}`, { priority: "NORMAL" });
  };

  const handleShareWa = (text: string) => {
    if (!waPhone) return;
    window.open(buildWhatsAppLink(waPhone, text), "_blank");
  };

  const handleShareEmail = (text: string) => {
    if (!contact.email) return;
    compose.open({
      to: contact.email,
      subject: `Following up — ${contact.firstName || "contact"}`,
      body: `<p>${text.replace(/\n/g, "<br/>")}</p>`,
    });
  };

  const entries = useMemo<UnifiedEntry[]>(() => {
    if (crossJourney?.timeline && crossJourney.timeline.length > 0) {
      return crossJourney.timeline.map((item) => {
        const cfg = EVENT_CONFIG[item.type] || DEFAULT_CONFIG;
        const mod = (item.module === "crm" || item.module === "bookings" || item.module === "commerce" || item.module === "marketing")
          ? item.module as ModuleFilter
          : classifyEvent(item.type);
        const hrefFn = item.ctaModule ? CTA_HREF_MAP[item.ctaModule] : undefined;
        return {
          id: item.id,
          module: mod,
          kind: "event",
          icon: cfg.icon,
          iconColor: cfg.color,
          iconBg: cfg.bg,
          title: item.title || cfg.label || item.type,
          description: item.description,
          timestamp: item.timestamp,
          value: item.value,
          currency: item.currency,
          ctaLabel: item.ctaLabel,
          ctaHref: hrefFn ? hrefFn(item.entityId) : undefined,
          rawType: item.type,
        };
      });
    }

    const out: UnifiedEntry[] = [];

    for (const ev of events) {
      const cfg = EVENT_CONFIG[ev.type] || DEFAULT_CONFIG;
      const mod = cfg.label ? cfg.module : classifyEvent(ev.type);
      const data = ev.data as Record<string, unknown> | null | undefined;

      let description: string | undefined;
      if ((ev.type === "status.changed" || ev.type === "STATUS_CHANGED") && data?.from && data?.to) {
        description = `${data.from} → ${data.to}`;
      } else if (ev.type === "invoice.paid" && data?.amount) {
        description = `Amount: ${formatAmount(Number(data.amount), (data.currency as string) || "TTD")}`;
      } else if (typeof data?.description === "string") {
        description = data.description;
      }

      let ctaLabel: string | undefined;
      let ctaHref: string | undefined;
      let entityId: string | undefined;
      if (ev.type.startsWith("invoice.") && typeof data?.invoiceId === "string") {
        ctaLabel = "View Invoice"; entityId = data.invoiceId;
        ctaHref = `/app/commerce?tab=invoices&id=${encodeURIComponent(entityId)}`;
      } else if (ev.type.startsWith("booking.") && typeof data?.bookingId === "string") {
        ctaLabel = "View Booking"; entityId = data.bookingId;
        ctaHref = `/app/bookings?id=${encodeURIComponent(entityId)}`;
      } else if (ev.type.startsWith("campaign.") && typeof data?.campaignId === "string") {
        ctaLabel = "View Campaign"; entityId = data.campaignId;
        ctaHref = `/app/marketing?tab=calendar&id=${encodeURIComponent(entityId)}`;
      }

      out.push({
        id: `ev-${ev.id}`,
        module: mod,
        kind: "event",
        icon: cfg.icon,
        iconColor: cfg.color,
        iconBg: cfg.bg,
        title: cfg.label || EVENT_LABELS[ev.type] || ev.type,
        description,
        timestamp: ev.createdAt,
        value: typeof data?.amount === "number" ? data.amount : undefined,
        currency: typeof data?.currency === "string" ? data.currency : undefined,
        ctaLabel,
        ctaHref,
        rawType: ev.type,
      });
    }

    const noteEventIds = new Set<string>();
    for (const e of events) {
      if (e.type === "note.created" || e.type === "note.added" || e.type === "note.updated") {
        const d = e.data as Record<string, unknown> | null | undefined;
        if (typeof d?.noteId === "string") noteEventIds.add(d.noteId);
      }
    }
    for (const note of notes) {
      if (noteEventIds.has(note.id)) continue;
      out.push({
        id: `note-${note.id}`,
        module: "notes",
        kind: "note",
        icon: StickyNote,
        iconColor: "hsl(var(--kf-accent1))",
        iconBg: "hsl(var(--kf-accent1) / 0.15)",
        title: "Note added",
        description: note.body.length > 120 ? note.body.slice(0, 120) + "…" : note.body,
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
      const done = task.status === "DONE";
      out.push({
        id: `task-${task.id}`,
        module: "tasks",
        kind: "task",
        icon: done ? CheckCircle2 : ListTodo,
        iconColor: done ? "hsl(var(--kf-success))" : "hsl(var(--kf-accent1))",
        iconBg: done ? "hsl(var(--kf-success) / 0.15)" : "hsl(var(--kf-accent1) / 0.15)",
        title: done ? "Task completed" : "Task created",
        description: task.title,
        timestamp: (done ? task.completedAt : task.createdAt) || task.createdAt || new Date().toISOString(),
      });
    }

    for (const inv of invoices) {
      const tracked = events.some((e) => e.type.startsWith("invoice.") && (e.data as Record<string, unknown> | null | undefined)?.invoiceId === inv.id);
      if (tracked) continue;
      const total = typeof inv.total === "number" ? inv.total : 0;
      const isPaid = inv.status === "PAID";
      const isOverdue = inv.status === "OVERDUE";
      out.push({
        id: `inv-${inv.id}`,
        module: "commerce",
        kind: "invoice",
        icon: isPaid ? DollarSign : isOverdue ? AlertTriangle : FileText,
        iconColor: isPaid ? "hsl(var(--kf-success))" : isOverdue ? "hsl(var(--kf-error))" : "hsl(var(--kf-info))",
        iconBg: isPaid ? "hsl(var(--kf-success) / 0.15)" : isOverdue ? "hsl(var(--kf-error) / 0.15)" : "hsl(var(--kf-info) / 0.15)",
        title: isPaid ? "Payment received" : isOverdue ? "Invoice overdue" : `Invoice ${inv.status.toLowerCase()}`,
        description: total > 0 ? formatAmount(total, inv.currency || "TTD") : undefined,
        timestamp: inv.paidAt || inv.issueDate || inv.createdAt || new Date().toISOString(),
        value: total,
        currency: inv.currency || "TTD",
        ctaLabel: "View Invoice",
        ctaHref: `/app/commerce?tab=invoices&id=${encodeURIComponent(inv.id)}`,
      });
    }

    for (const bk of bookings) {
      const tracked = events.some((e) => e.type.startsWith("booking.") && (e.data as Record<string, unknown> | null | undefined)?.bookingId === bk.id);
      if (tracked) continue;
      const isCompleted = bk.status === "COMPLETED";
      const isCancelled = bk.status === "CANCELLED";
      out.push({
        id: `bk-${bk.id}`,
        module: "bookings",
        kind: "booking",
        icon: isCompleted ? Star : isCancelled ? AlertTriangle : Calendar,
        iconColor: isCompleted ? "hsl(var(--kf-warning))" : isCancelled ? "hsl(var(--kf-error))" : "hsl(var(--kf-accent2))",
        iconBg: isCompleted ? "hsl(var(--kf-warning) / 0.15)" : isCancelled ? "hsl(var(--kf-error) / 0.15)" : "hsl(var(--kf-accent2) / 0.15)",
        title: isCompleted ? "Service completed" : isCancelled ? "Booking cancelled" : "Appointment scheduled",
        description: bk.service?.name || undefined,
        timestamp: bk.startTime,
        value: bk.service?.price,
        currency: "TTD",
        ctaLabel: "View Booking",
        ctaHref: `/app/bookings?id=${encodeURIComponent(bk.id)}`,
      });
    }

    out.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return out;
  }, [crossJourney, events, notes, tasks, invoices, bookings]);

  const moduleCounts = useMemo(() => {
    const c: Record<ModuleFilter, number> = { all: entries.length, crm: 0, bookings: 0, commerce: 0, marketing: 0, notes: 0, tasks: 0 };
    for (const e of entries) c[e.module]++;
    return c;
  }, [entries]);

  const summary = useMemo(() => {
    if (crossJourney?.summary) {
      const s = crossJourney.summary;
      const lastTs = s.lastInteractionAt ? new Date(s.lastInteractionAt).getTime() : null;
      // eslint-disable-next-line react-hooks/purity -- audited: time-relative days-since computation
      const daysSince = lastTs ? Math.floor((Date.now() - lastTs) / 86400000) : 999;
      return {
        totalRevenue: s.totalRevenue,
        bookingsCount: s.bookingsCount,
        lastInteractionTs: lastTs,
        momentum: s.momentum,
        engagementLevel: s.engagementLevel as "high" | "medium" | "low",
        daysSinceLastInteraction: daysSince,
      };
    }
    const paidRevenue = invoices.filter((i) => i.status === "PAID").reduce((s, i) => s + (typeof i.total === "number" ? i.total : 0), 0);
    const ts = entries.map((e) => new Date(e.timestamp).getTime()).filter((t) => !Number.isNaN(t));
    const lastTs = ts.length > 0 ? Math.max(...ts) : null;
    // eslint-disable-next-line react-hooks/purity -- audited: time-relative days-since computation
    const daysSince = lastTs ? Math.floor((Date.now() - lastTs) / 86400000) : 999;
    const momentum = computeMomentumScore(events.length, bookings.length, paidRevenue, daysSince);
    const engLevel: "high" | "medium" | "low" = events.length >= 10 ? "high" : events.length >= 3 ? "medium" : "low";
    return { totalRevenue: paidRevenue, bookingsCount: bookings.length, lastInteractionTs: lastTs, momentum, engagementLevel: engLevel, daysSinceLastInteraction: daysSince };
  }, [crossJourney, entries, events.length, invoices, bookings]);

  const filtered = useMemo(() => filter === "all" ? entries : entries.filter((e) => e.module === filter), [entries, filter]);

  const dateGroups = useMemo(() => {
    const groups: { label: string; entries: UnifiedEntry[] }[] = [];
    const visible = filtered.slice(0, limit);
    let cur = "";
    for (const e of visible) {
      const d = new Date(e.timestamp);
      // eslint-disable-next-line react-hooks/purity -- audited: time-relative grouping
      const diff = Math.floor((Date.now() - d.getTime()) / 86400000);
      let label: string;
      if (diff <= 0) label = "Today";
      else if (diff === 1) label = "Yesterday";
      else if (diff < 7) label = "This Week";
      else if (diff < 30) label = "This Month";
      else if (diff < 90) label = "Last 3 Months";
      else label = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
      if (label !== cur) { groups.push({ label, entries: [] }); cur = label; }
      groups[groups.length - 1].entries.push(e);
    }
    return groups;
  }, [filtered, limit]);

  const momentumColor = summary.momentum >= 70 ? "text-[hsl(var(--kf-success))]" : summary.momentum >= 40 ? "text-[hsl(var(--kf-warning))]" : "text-[hsl(var(--kf-error))]";
  const momentumBg = summary.momentum >= 70 ? "bg-[hsl(var(--kf-success))]/10" : summary.momentum >= 40 ? "bg-[hsl(var(--kf-warning))]/10" : "bg-[hsl(var(--kf-error))]/10";
  const engagementColor = summary.engagementLevel === "high" ? "text-[hsl(var(--kf-success))]" : summary.engagementLevel === "medium" ? "text-[hsl(var(--kf-warning))]" : "text-[hsl(var(--kf-error))]";
  const engagementLabel = summary.engagementLevel === "high" ? "High" : summary.engagementLevel === "medium" ? "Medium" : "Low";

  const healthAvg = healthMetrics ? Math.round(Object.values(healthMetrics).reduce((s, v) => s + v, 0) / 4) : null;

  if (entries.length === 0 && !healthMetrics && !aiInsight && !conversationContext) {
    return (
      <div className="text-center py-8 space-y-2">
        <div className="mx-auto w-12 h-12 rounded-full bg-muted/30 flex items-center justify-center">
          <Clock className="w-6 h-6 text-muted-foreground/40" />
        </div>
        <p className="text-sm text-muted-foreground">No timeline activity yet</p>
        <p className="text-xs text-muted-foreground/60">Events, notes, tasks, bookings, and invoices will appear here.</p>
      </div>
    );
  }

  const SummaryChips = (
    <div className="grid grid-cols-3 gap-2">
      <div className={`rounded-lg border border-border/50 p-2 ${momentumBg}`}>
        <div className="flex items-center gap-1 mb-0.5"><TrendingUp className="w-3 h-3" /><span className="text-[10px] text-muted-foreground">Momentum</span></div>
        <div className={`text-xs font-semibold ${momentumColor}`}>{summary.momentum}/100</div>
      </div>
      <div className="rounded-lg bg-muted/30 border border-border/50 p-2">
        <div className="flex items-center gap-1 mb-0.5"><DollarSign className="w-3 h-3 text-[hsl(var(--kf-success))]" /><span className="text-[10px] text-muted-foreground">Revenue</span></div>
        <div className="text-xs font-semibold">{summary.totalRevenue > 0 ? formatAmount(summary.totalRevenue) : "—"}</div>
      </div>
      <div className="rounded-lg bg-muted/30 border border-border/50 p-2">
        <div className="flex items-center gap-1 mb-0.5"><Calendar className="w-3 h-3 text-[hsl(var(--kf-accent2))]" /><span className="text-[10px] text-muted-foreground">Bookings</span></div>
        <div className="text-xs font-semibold">{summary.bookingsCount}</div>
      </div>
      <div className="rounded-lg bg-muted/30 border border-border/50 p-2">
        <div className="flex items-center gap-1 mb-0.5"><Clock className="w-3 h-3 text-[hsl(var(--kf-info))]" /><span className="text-[10px] text-muted-foreground">Last</span></div>
        <div className="text-xs font-semibold">
          {summary.lastInteractionTs ? (summary.daysSinceLastInteraction === 0 ? "Today" : summary.daysSinceLastInteraction === 1 ? "Yesterday" : `${summary.daysSinceLastInteraction}d ago`) : "—"}
        </div>
      </div>
      <div className="rounded-lg bg-muted/30 border border-border/50 p-2">
        <div className="flex items-center gap-1 mb-0.5"><Activity className="w-3 h-3 text-[hsl(var(--kf-accent1))]" /><span className="text-[10px] text-muted-foreground">Engagement</span></div>
        <div className={`text-xs font-semibold ${engagementColor}`}>{engagementLabel}</div>
      </div>
      {healthAvg != null && (
        <div className="rounded-lg bg-muted/30 border border-border/50 p-2">
          <div className="flex items-center gap-1 mb-0.5"><Heart className="w-3 h-3 text-[hsl(var(--kf-accent1))]" /><span className="text-[10px] text-muted-foreground">Health</span></div>
          <div className="text-xs font-semibold">{healthAvg}%</div>
        </div>
      )}
    </div>
  );

  const renderEntryRow = (entry: UnifiedEntry, idx: number) => {
    const Icon = entry.icon;
    const label = entry.title;
    const fullText = `${label} — ${new Date(entry.timestamp).toLocaleString("en-TT")}`;
    return (
      <motion.div
        key={entry.id}
        initial={{ opacity: 0, x: -6 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: idx * 0.015, duration: 0.18 }}
        className="relative flex gap-2.5 group"
      >
        <div className="absolute left-[-14px] p-1 rounded-full bg-background border-2 z-10" style={{ borderColor: entry.iconColor }}>
          <Icon className="w-2.5 h-2.5" style={{ color: entry.iconColor }} />
        </div>
        <div className="flex-1 ml-2 p-2 rounded-xl bg-muted/20 border border-border/40 hover:border-border/60 transition-colors">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-xs font-medium truncate">{label}</span>
              <span className="text-[9px] px-1.5 py-0.5 rounded-full whitespace-nowrap" style={{ background: entry.iconBg, color: entry.iconColor }}>
                {getModuleLabel(entry.module)}
              </span>
            </div>
            <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">
              {new Date(entry.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </span>
          </div>
          {entry.description && <p className="text-[11px] text-muted-foreground mt-0.5">{entry.description}</p>}
          {entry.value != null && entry.value > 0 && !entry.description?.includes("TTD") && (
            <p className="text-[11px] font-medium mt-0.5" style={{ color: entry.iconColor }}>{formatAmount(entry.value, entry.currency)}</p>
          )}
          <div className="flex items-center gap-0.5 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={() => handleCopy(entry.id, fullText)} className="p-1 rounded-md hover:bg-muted transition-colors" title="Copy">
              {copiedId === entry.id ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-muted-foreground" />}
            </button>
            {onAddNote && (
              <button onClick={() => handleCreateNoteFrom(label)} className="p-1 rounded-md hover:bg-violet-500/10 transition-colors" title="Create note from event">
                <StickyNote className="w-3 h-3 text-violet-400" />
              </button>
            )}
            {onAddTask && (
              <button onClick={() => handleCreateTaskFrom(label)} className="p-1 rounded-md hover:bg-blue-500/10 transition-colors" title="Create task from event">
                <ListTodo className="w-3 h-3 text-blue-400" />
              </button>
            )}
            {waPhone && (
              <button onClick={() => handleShareWa(label)} className="p-1 rounded-md hover:bg-emerald-500/10 transition-colors" title="Share via WhatsApp">
                <MessageCircle className="w-3 h-3 text-emerald-500" />
              </button>
            )}
            {contact.email && (
              <button onClick={() => handleShareEmail(label)} className="p-1 rounded-md hover:bg-blue-500/10 transition-colors" title="Share via Email">
                <Mail className="w-3 h-3 text-blue-400" />
              </button>
            )}
            {entry.ctaLabel && entry.ctaHref && (
              <a href={entry.ctaHref} className="ml-1 inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/20">
                <ExternalLink className="w-2.5 h-2.5" />
                {entry.ctaLabel}
              </a>
            )}
          </div>
        </div>
      </motion.div>
    );
  };

  const compactPreview = entries.slice(0, 6);

  const AiInsightCard = aiInsight ? (
    <div className="rounded-xl bg-gradient-to-br from-[hsl(var(--kf-accent1))]/5 to-[hsl(var(--kf-accent2))]/5 border border-[hsl(var(--kf-accent1))]/20 p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-medium text-[hsl(var(--kf-accent1))] flex items-center gap-1 mb-1"><Brain className="w-3 h-3" />AI Summary</div>
          <p className="text-xs">{aiInsight.summary}</p>
        </div>
        {aiInsight.confidence > 0 && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap ${aiInsight.confidence >= 80 ? "bg-emerald-500/10 text-emerald-400" : aiInsight.confidence >= 50 ? "bg-amber-500/10 text-amber-400" : "bg-red-500/10 text-red-400"}`}>{aiInsight.confidence}%</span>
        )}
      </div>
      {aiInsight.nextBestAction && (
        <div className="rounded-lg bg-[hsl(var(--kf-accent2))]/10 border border-[hsl(var(--kf-accent2))]/20 p-2">
          <div className="text-[10px] font-medium text-[hsl(var(--kf-accent2))] flex items-center gap-1"><Zap className="w-3 h-3" />Next Best Action</div>
          <p className="text-xs font-medium mt-0.5">{aiInsight.nextBestAction}</p>
          <div className="flex items-center gap-1 pt-1 flex-wrap">
            {onAddTask && (
              <button onClick={() => onAddTask(aiInsight.nextBestAction, { priority: "HIGH" })} className="text-[10px] px-2 py-0.5 rounded-md bg-[hsl(var(--kf-accent2))]/10 text-[hsl(var(--kf-accent2))] hover:bg-[hsl(var(--kf-accent2))]/20 flex items-center gap-1">
                <ListTodo className="w-2.5 h-2.5" />Create Task
              </button>
            )}
            {onAddNote && (
              <button onClick={() => onAddNote(aiInsight.nextBestAction, "general")} className="text-[10px] px-2 py-0.5 rounded-md bg-muted text-muted-foreground hover:text-foreground flex items-center gap-1">
                <StickyNote className="w-2.5 h-2.5" />Save as Note
              </button>
            )}
          </div>
        </div>
      )}
      {aiInsight.suggestedMessage && (
        <div className="rounded-lg bg-muted/30 border border-border/50 p-2 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium text-muted-foreground flex items-center gap-1"><MessageSquare className="w-3 h-3" />Suggested Message</span>
            <div className="flex items-center gap-0.5">
              <button onClick={() => handleCopyAi(aiInsight.suggestedMessage!)} className="p-1 rounded-md hover:bg-muted" title="Copy">
                {aiCopied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-muted-foreground" />}
              </button>
              {waPhone && (
                <button onClick={() => handleShareWa(aiInsight.suggestedMessage!)} className="p-1 rounded-md hover:bg-emerald-500/10" title="Send via WhatsApp">
                  <MessageCircle className="w-3 h-3 text-emerald-500" />
                </button>
              )}
              {contact.email && (
                <button onClick={() => handleShareEmail(aiInsight.suggestedMessage!)} className="p-1 rounded-md hover:bg-blue-500/10" title="Send via Email">
                  <Mail className="w-3 h-3 text-blue-400" />
                </button>
              )}
            </div>
          </div>
          <p className="text-[11px] italic border-l-2 border-[hsl(var(--kf-accent1))] pl-2">&ldquo;{aiInsight.suggestedMessage}&rdquo;</p>
        </div>
      )}
      {onGenerateAiInsight && (
        <button onClick={onGenerateAiInsight} disabled={aiInsightLoading} className="w-full flex items-center justify-center gap-1.5 py-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
          <RefreshCw className={`w-3 h-3 ${aiInsightLoading ? "animate-spin" : ""}`} />
          {aiInsightLoading ? "Analyzing..." : "Regenerate Insights"}
        </button>
      )}
    </div>
  ) : onGenerateAiInsight ? (
    <div className="rounded-xl border border-border/50 p-3 text-center space-y-2">
      <div className="mx-auto w-8 h-8 rounded-full bg-muted flex items-center justify-center"><Brain className="w-4 h-4 text-muted-foreground" /></div>
      <p className="text-[11px] text-muted-foreground">AI-powered insights for this contact</p>
      <button onClick={onGenerateAiInsight} disabled={aiInsightLoading} className="kf-btn-primary inline-flex items-center gap-1.5 text-xs">
        <Sparkles className="w-3 h-3" />
        {aiInsightLoading ? "Analyzing..." : "Generate Insights"}
      </button>
    </div>
  ) : null;

  const ConvCard = conversationContext ? (
    <div className="rounded-xl bg-muted/30 border border-border/50 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium flex items-center gap-1.5"><Target className="w-3.5 h-3.5 text-[hsl(var(--kf-accent2))]" />Conversation Context</span>
        {onRefreshConversationContext && (
          <button onClick={onRefreshConversationContext} className="p-1 rounded-md hover:bg-muted" title="Refresh">
            <RefreshCw className="w-3 h-3 text-muted-foreground" />
          </button>
        )}
      </div>
      {conversationContext.lastDiscussed && (
        <div className="p-2 rounded-lg bg-muted/30 text-[11px]"><span className="text-muted-foreground">Last discussed: </span>{conversationContext.lastDiscussed}</div>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        {conversationContext.sentiment && (
          <span className={`text-[10px] px-2 py-0.5 rounded-full ${conversationContext.sentiment === "positive" ? "bg-emerald-500/10 text-emerald-400" : conversationContext.sentiment === "negative" ? "bg-red-500/10 text-red-400" : "bg-muted text-muted-foreground"}`}>
            {conversationContext.sentiment === "positive" ? "Positive" : conversationContext.sentiment === "negative" ? "Needs care" : "Neutral"} sentiment
          </span>
        )}
        {conversationContext.engagementLevel && (
          <span className="text-[10px] text-muted-foreground">Engagement: <span className="font-medium capitalize">{conversationContext.engagementLevel}</span></span>
        )}
      </div>
      {conversationContext.concerns && conversationContext.concerns.length > 0 && (
        <div className="p-2 rounded-lg bg-amber-500/5 border border-amber-500/10">
          <div className="text-[10px] font-medium text-amber-400 flex items-center gap-1 mb-1"><AlertCircle className="w-2.5 h-2.5" />Concerns</div>
          {conversationContext.concerns.map((c, i) => (<p key={i} className="text-[11px] flex items-start gap-1"><span className="text-amber-400">•</span> {c}</p>))}
        </div>
      )}
      {conversationContext.preferences && conversationContext.preferences.length > 0 && (
        <div className="p-2 rounded-lg bg-[hsl(var(--kf-accent2))]/5 border border-[hsl(var(--kf-accent2))]/10">
          <div className="text-[10px] font-medium text-[hsl(var(--kf-accent2))] flex items-center gap-1 mb-1"><Heart className="w-2.5 h-2.5" />Preferences</div>
          {conversationContext.preferences.map((p, i) => (<p key={i} className="text-[11px] flex items-start gap-1"><span className="text-[hsl(var(--kf-accent2))]">•</span> {p}</p>))}
        </div>
      )}
      {conversationContext.suggestedOpening && (
        <div className="p-2 rounded-lg bg-[hsl(var(--kf-accent1))]/5 border border-[hsl(var(--kf-accent1))]/10">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-medium text-[hsl(var(--kf-accent1))] flex items-center gap-1"><Sparkles className="w-2.5 h-2.5" />Suggested opening</span>
            <div className="flex items-center gap-0.5">
              <button onClick={() => handleCopyAi(conversationContext.suggestedOpening!)} className="p-1 rounded-md hover:bg-muted" title="Copy">
                {aiCopied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-muted-foreground" />}
              </button>
              {waPhone && (
                <button onClick={() => handleShareWa(conversationContext.suggestedOpening!)} className="p-1 rounded-md hover:bg-emerald-500/10" title="Send via WhatsApp">
                  <MessageCircle className="w-3 h-3 text-emerald-500" />
                </button>
              )}
              {contact.email && (
                <button onClick={() => handleShareEmail(conversationContext.suggestedOpening!)} className="p-1 rounded-md hover:bg-blue-500/10" title="Send via Email">
                  <Mail className="w-3 h-3 text-blue-400" />
                </button>
              )}
            </div>
          </div>
          <p className="text-[11px] italic">&ldquo;{conversationContext.suggestedOpening}&rdquo;</p>
        </div>
      )}
    </div>
  ) : null;

  if (!expanded) {
    return (
      <div className="space-y-3">
        {SummaryChips}

        {healthMetrics && (
          <div className="rounded-xl bg-muted/30 border border-border/50 p-2.5">
            <div className="grid grid-cols-4 gap-2">
              {HEALTH_METRICS_CONFIG.map(({ key, label, icon: Icon }) => {
                const value = healthMetrics[key];
                const barColor = value >= 70 ? "hsl(142 76% 36%)" : value >= 40 ? "hsl(var(--kf-accent2))" : "hsl(var(--kf-accent1))";
                return (
                  <div key={key} className="space-y-0.5">
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground"><Icon className="w-3 h-3" />{label}</div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${value}%`, background: barColor }} />
                    </div>
                    <div className="text-[10px] font-medium" style={{ color: barColor }}>{value}%</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {AiInsightCard}

        {compactPreview.length > 0 ? (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="w-full text-left rounded-xl border border-border/50 bg-muted/10 hover:bg-muted/20 transition-colors p-3 space-y-2"
            aria-label="Expand timeline"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium flex items-center gap-1.5"><History className="w-3.5 h-3.5 text-[hsl(var(--kf-accent1))]" />Recent Timeline</span>
              <span className="text-[10px] text-[hsl(var(--kf-accent1))] flex items-center gap-1">Expand <ChevronDown className="w-3 h-3" /></span>
            </div>
            <div className="relative pl-5 space-y-2">
              <div className="absolute left-[7px] top-1 bottom-1 w-0.5 bg-gradient-to-b from-[hsl(var(--kf-accent1))]/40 via-border/30 to-transparent" />
              {compactPreview.map((entry, idx) => {
                const Icon = entry.icon;
                return (
                  <div key={entry.id} className="relative flex gap-2.5">
                    <div className="absolute left-[-14px] p-1 rounded-full bg-background border-2 z-10" style={{ borderColor: entry.iconColor }}>
                      <Icon className="w-2.5 h-2.5" style={{ color: entry.iconColor }} />
                    </div>
                    <div className="flex-1 ml-2 py-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-xs font-medium truncate">{entry.title}</span>
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full whitespace-nowrap" style={{ background: entry.iconBg, color: entry.iconColor }}>{getModuleLabel(entry.module)}</span>
                        </div>
                        <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">
                          {new Date(entry.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </span>
                      </div>
                      {entry.description && <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{entry.description}</p>}
                    </div>
                    {idx === compactPreview.length - 1 && entries.length > compactPreview.length && (
                      <span className="text-[10px] text-muted-foreground/60 self-center ml-2">+{entries.length - compactPreview.length} more</span>
                    )}
                  </div>
                );
              })}
            </div>
          </button>
        ) : (
          <div className="text-center py-4 text-xs text-muted-foreground">No timeline activity yet.</div>
        )}

        {ConvCard}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-medium"><History className="w-3.5 h-3.5 text-[hsl(var(--kf-accent1))]" />Timeline</div>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="text-[10px] px-2 py-1 rounded-md bg-muted text-muted-foreground hover:text-foreground flex items-center gap-1"
          aria-label="Collapse timeline"
        >
          <ChevronUp className="w-3 h-3" /> Show less
        </button>
      </div>

      {SummaryChips}

      {healthMetrics && (
        <div className="rounded-xl bg-muted/30 border border-border/50 p-2.5">
          <div className="grid grid-cols-4 gap-2">
            {HEALTH_METRICS_CONFIG.map(({ key, label, icon: Icon }) => {
              const value = healthMetrics[key];
              const barColor = value >= 70 ? "hsl(142 76% 36%)" : value >= 40 ? "hsl(var(--kf-accent2))" : "hsl(var(--kf-accent1))";
              return (
                <div key={key} className="space-y-0.5">
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground"><Icon className="w-3 h-3" />{label}</div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${value}%`, background: barColor }} />
                  </div>
                  <div className="text-[10px] font-medium" style={{ color: barColor }}>{value}%</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex items-center gap-1 flex-wrap">
        <div className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground mr-1"><Package className="w-3 h-3" />Filter</div>
        {MODULE_PILLS.map((p) => {
          const cnt = moduleCounts[p.key];
          const active = filter === p.key;
          if (p.key !== "all" && cnt === 0) return null;
          return (
            <button
              key={p.key}
              onClick={() => { setFilter(p.key); setLimit(25); }}
              className={`text-[10px] px-2 py-1 rounded-md transition-colors flex items-center gap-1 ${active ? "bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))]" : "bg-muted text-muted-foreground hover:text-foreground"}`}
            >
              <p.icon className="w-3 h-3" />
              {p.label}
              {cnt > 0 && <span className="text-[9px] opacity-70">({cnt})</span>}
            </button>
          );
        })}
      </div>

      {AiInsightCard}
      {ConvCard}

      {filtered.length === 0 ? (
        <div className="text-center py-6 space-y-1">
          <History className="w-6 h-6 mx-auto text-muted-foreground/40" />
          <p className="text-xs text-muted-foreground">No entries for this filter</p>
        </div>
      ) : (
        <div className="space-y-4">
          {dateGroups.map((group) => (
            <div key={group.label}>
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 pl-1">{group.label}</div>
              <div className="relative pl-5 space-y-2">
                <div className="absolute left-[7px] top-1 bottom-1 w-0.5 bg-gradient-to-b from-[hsl(var(--kf-accent1))] via-[hsl(var(--kf-accent2))] to-muted/30" />
                {group.entries.map((entry, idx) => renderEntryRow(entry, idx))}
              </div>
            </div>
          ))}
        </div>
      )}

      {filtered.length > limit && (
        <button onClick={() => setLimit((p) => p + 25)} className="w-full text-center text-xs text-muted-foreground hover:text-foreground py-2 flex items-center justify-center gap-1">
          <ChevronDown className="w-3 h-3" /> Show more ({filtered.length - limit} remaining)
        </button>
      )}
      {limit > 25 && (
        <button onClick={() => setLimit(25)} className="w-full text-center text-xs text-muted-foreground hover:text-foreground py-1 flex items-center justify-center gap-1">
          <ChevronUp className="w-3 h-3" /> Show less
        </button>
      )}
    </div>
  );
}
