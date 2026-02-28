import {
  MessageSquare, ListTodo, History,
  StickyNote, Copy, MessageCircle, Mail,
  Pin, PinOff, ListPlus,
  Phone as PhoneIcon, Video, Handshake,
  FileText, Lightbulb, AlertCircle,
  Check, Clock, Flag, Bell, Calendar,
  ArrowUpDown, CheckCircle2, Circle,
  AlertTriangle, Sparkles, DollarSign,
  TrendingUp, Users, Heart, Brain,
  Zap, Target, RefreshCw, Star, Gift,
  Trash, UserX, Tags,
} from "lucide-react";

export const EVENT_LABELS: Record<string, string> = {
  "contact.created": "Contact created",
  "contact.updated": "Contact updated",
  "contact.merged": "Contacts merged",
  "contact.deleted": "Contact deleted",
  "contact.imported": "Contact imported",
  "contact.imported_from_media": "Contact scanned",
  "status.changed": "Status changed",
  "STATUS_CHANGED": "Status changed",
  "invoice.created": "Invoice created",
  "invoice.sent": "Invoice sent",
  "invoice.paid": "Invoice paid",
  "invoice.overdue": "Invoice overdue",
  "invoice.void": "Invoice voided",
  "invoice.payment_failed": "Payment failed",
  "booking.created": "Booking made",
  "booking.confirmed": "Booking confirmed",
  "booking.completed": "Booking completed",
  "booking.cancelled": "Booking cancelled",
  "quote.created": "Quote sent",
  "quote.sent": "Quote sent",
  "quote.accepted": "Quote accepted",
  "quote.rejected": "Quote rejected",
  "note.added": "Note added",
  "note.created": "Note added",
  "note.deleted": "Note deleted",
  "task.created": "Task created",
  "task.completed": "Task completed",
  "task.reopened": "Task reopened",
  "task.deleted": "Task deleted",
  "email.sent": "Email sent",
  "whatsapp.sent": "WhatsApp message sent",
  "message.copied": "Message copied",
  "form.submitted": "Form submitted",
  "followup.scheduled": "Follow-up scheduled",
  "automation.run": "Automation triggered",
  "automation.executed": "Automation executed",
  "bulk.updated": "Bulk updated",
};

export const EVENT_ICONS: Record<string, { icon: typeof MessageSquare; color: string }> = {
  "contact.created": { icon: Sparkles, color: "hsl(var(--kf-accent1))" },
  "contact.updated": { icon: RefreshCw, color: "hsl(var(--kf-muted-foreground))" },
  "contact.merged": { icon: Users, color: "hsl(var(--kf-accent2))" },
  "contact.deleted": { icon: UserX, color: "hsl(0 84% 60%)" },
  "contact.imported": { icon: Users, color: "hsl(var(--kf-accent2))" },
  "contact.imported_from_media": { icon: Sparkles, color: "hsl(var(--kf-accent2))" },
  "status.changed": { icon: TrendingUp, color: "hsl(var(--kf-accent2))" },
  "STATUS_CHANGED": { icon: TrendingUp, color: "hsl(var(--kf-accent2))" },
  "invoice.created": { icon: FileText, color: "hsl(217 91% 60%)" },
  "invoice.sent": { icon: Mail, color: "hsl(217 91% 60%)" },
  "invoice.paid": { icon: DollarSign, color: "hsl(142 76% 36%)" },
  "invoice.overdue": { icon: AlertTriangle, color: "hsl(0 84% 60%)" },
  "invoice.void": { icon: AlertCircle, color: "hsl(var(--kf-muted-foreground))" },
  "invoice.payment_failed": { icon: AlertTriangle, color: "hsl(0 84% 60%)" },
  "booking.created": { icon: Calendar, color: "hsl(var(--kf-accent2))" },
  "booking.confirmed": { icon: CheckCircle2, color: "hsl(142 76% 36%)" },
  "booking.completed": { icon: Star, color: "hsl(45 93% 47%)" },
  "booking.cancelled": { icon: AlertCircle, color: "hsl(0 84% 60%)" },
  "quote.created": { icon: FileText, color: "hsl(217 91% 60%)" },
  "quote.sent": { icon: Mail, color: "hsl(217 91% 60%)" },
  "quote.accepted": { icon: CheckCircle2, color: "hsl(142 76% 36%)" },
  "quote.rejected": { icon: AlertCircle, color: "hsl(0 84% 60%)" },
  "note.added": { icon: StickyNote, color: "hsl(var(--kf-muted-foreground))" },
  "note.created": { icon: StickyNote, color: "hsl(var(--kf-muted-foreground))" },
  "note.deleted": { icon: Trash, color: "hsl(var(--kf-muted-foreground))" },
  "task.created": { icon: ListTodo, color: "hsl(var(--kf-accent2))" },
  "task.completed": { icon: CheckCircle2, color: "hsl(142 76% 36%)" },
  "task.reopened": { icon: RefreshCw, color: "hsl(var(--kf-accent1))" },
  "task.deleted": { icon: Trash, color: "hsl(var(--kf-muted-foreground))" },
  "email.sent": { icon: Mail, color: "hsl(217 91% 60%)" },
  "whatsapp.sent": { icon: MessageCircle, color: "hsl(142 76% 36%)" },
  "message.copied": { icon: Copy, color: "hsl(var(--kf-muted-foreground))" },
  "form.submitted": { icon: FileText, color: "hsl(var(--kf-accent1))" },
  "followup.scheduled": { icon: Bell, color: "hsl(var(--kf-accent1))" },
  "automation.run": { icon: Zap, color: "hsl(var(--kf-accent2))" },
  "automation.executed": { icon: Zap, color: "hsl(var(--kf-accent2))" },
  "bulk.updated": { icon: Tags, color: "hsl(var(--kf-accent2))" },
};

export const MILESTONE_ICONS: Record<string, { icon: typeof MessageSquare; color: string }> = {
  first_contact: { icon: Sparkles, color: "hsl(var(--kf-accent1))" },
  call: { icon: PhoneIcon, color: "hsl(var(--kf-accent2))" },
  quote_sent: { icon: FileText, color: "hsl(217 91% 60%)" },
  quote_accepted: { icon: CheckCircle2, color: "hsl(142 76% 36%)" },
  payment: { icon: DollarSign, color: "hsl(142 76% 36%)" },
  booking: { icon: Calendar, color: "hsl(var(--kf-accent2))" },
  completed: { icon: Star, color: "hsl(45 93% 47%)" },
  milestone: { icon: Gift, color: "hsl(var(--kf-accent1))" },
  note: { icon: MessageSquare, color: "hsl(var(--kf-muted-foreground))" },
};

export const HEALTH_METRICS_CONFIG = [
  { key: "engagement" as const, label: "Engagement", icon: TrendingUp },
  { key: "payment" as const, label: "Payment", icon: DollarSign },
  { key: "responsiveness" as const, label: "Response", icon: MessageSquare },
  { key: "relationship" as const, label: "Relationship", icon: Users },
];

export const NOTE_CATEGORIES = [
  { key: "general", label: "General", icon: StickyNote, color: "text-muted-foreground", bg: "bg-muted" },
  { key: "call", label: "Call", icon: PhoneIcon, color: "text-violet-400", bg: "bg-violet-500/10" },
  { key: "meeting", label: "Meeting", icon: Video, color: "text-blue-400", bg: "bg-blue-500/10" },
  { key: "deal", label: "Deal", icon: Handshake, color: "text-emerald-400", bg: "bg-emerald-500/10" },
  { key: "follow-up", label: "Follow-up", icon: AlertCircle, color: "text-amber-400", bg: "bg-amber-500/10" },
  { key: "idea", label: "Idea", icon: Lightbulb, color: "text-yellow-400", bg: "bg-yellow-500/10" },
] as const;

export type NoteCategory = (typeof NOTE_CATEGORIES)[number]["key"];

export const NOTE_TEMPLATES = [
  { label: "Call summary", category: "call" as NoteCategory, body: "Called {name} — discussed:\n- \n\nNext steps:\n- " },
  { label: "Meeting recap", category: "meeting" as NoteCategory, body: "Met with {name}\n\nKey takeaways:\n- \n\nAction items:\n- " },
  { label: "Deal update", category: "deal" as NoteCategory, body: "Deal update for {name}:\nStatus: \nValue: TTD \nNext milestone: " },
  { label: "Follow-up needed", category: "follow-up" as NoteCategory, body: "Follow up with {name} regarding:\n- \n\nDeadline: " },
  { label: "Quick idea", category: "idea" as NoteCategory, body: "" },
];

export function getCategoryConfig(source?: string | null) {
  const key = source?.toLowerCase().replace(/[_\s]/g, "-") || "general";
  return NOTE_CATEGORIES.find((c) => c.key === key) || NOTE_CATEGORIES[0];
}

export const TASK_PRIORITIES = [
  { key: "HIGH", label: "High", icon: Flag, color: "text-red-400", bg: "bg-red-500/10" },
  { key: "NORMAL", label: "Normal", icon: Circle, color: "text-blue-400", bg: "bg-blue-500/10" },
  { key: "LOW", label: "Low", icon: ArrowUpDown, color: "text-muted-foreground", bg: "bg-muted" },
] as const;

export type TaskPriority = (typeof TASK_PRIORITIES)[number]["key"];
export type TaskFilter = "all" | "open" | "done" | "overdue";
export type TaskSort = "due" | "priority" | "created";

export const TASK_TEMPLATES = [
  { label: "Follow up", title: "Follow up with {name}", priority: "HIGH" as TaskPriority, daysOut: 1 },
  { label: "Send quote", title: "Send quote to {name}", priority: "NORMAL" as TaskPriority, daysOut: 0 },
  { label: "Schedule call", title: "Schedule a call with {name}", priority: "NORMAL" as TaskPriority, daysOut: 2 },
  { label: "Send invoice", title: "Send invoice to {name}", priority: "HIGH" as TaskPriority, daysOut: 0 },
  { label: "Prepare proposal", title: "Prepare proposal for {name}", priority: "NORMAL" as TaskPriority, daysOut: 3 },
];

export function getPriorityConfig(priority?: string | null) {
  return TASK_PRIORITIES.find((p) => p.key === priority) || TASK_PRIORITIES[1];
}

export function isOverdue(task: { status?: string | null; dueDate?: string | null }) {
  if (task.status === "DONE" || !task.dueDate) return false;
  return new Date(task.dueDate) < new Date();
}

export function isDueSoon(task: { status?: string | null; dueDate?: string | null }) {
  if (task.status === "DONE" || !task.dueDate) return false;
  const due = new Date(task.dueDate);
  const now = new Date();
  const diff = due.getTime() - now.getTime();
  return diff > 0 && diff < 24 * 60 * 60 * 1000;
}

export function formatRelativeDate(dateStr: string) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays === -1) return "Yesterday";
  if (diffDays < -1) return `${Math.abs(diffDays)} days ago`;
  if (diffDays <= 7) return `In ${diffDays} days`;
  return date.toLocaleDateString("en-TT", { dateStyle: "medium" });
}

export interface JourneyMilestoneData {
  id: string;
  type: string;
  title: string;
  description?: string;
  date: string;
  value?: number;
  isNext?: boolean;
}

export interface HealthMetricsData {
  engagement: number;
  payment: number;
  responsiveness: number;
  relationship: number;
}

export interface ConversationContextData {
  lastDiscussed?: string;
  concerns?: string[];
  preferences?: string[];
  suggestedOpening?: string;
  sentiment?: string;
  engagementLevel?: string;
}

export interface AiInsightData {
  summary: string;
  nextBestAction: string;
  reasoning?: string;
  confidence: number;
  suggestedMessage?: string;
  tags?: string[];
}
