"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  X,
  Mail,
  Phone,
  Building2,
  Briefcase,
  Calendar,
  DollarSign,
  TrendingUp,
  Clock,
  CheckCircle2,
  Plus,
  Sparkles,
  MessageSquare,
  ListTodo,
  History,
  Pencil,
  Trash2,
  MapPin,
  MessageCircle,
  Send,
  Copy,
  Globe,
  FileText,
  CalendarCheck,
  UserPlus,
  Upload,
  Star,
} from "lucide-react";
import { buildWhatsAppLink, getContactPhone } from "@/lib/whatsapp";

export type ContactDetailData = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  companyName?: string | null;
  jobTitle?: string | null;
  status?: string | null;
  source?: string | null;
  sourceDetail?: string | null;
  preferredChannel?: string | null;
  tags?: string[];
  addressLine1?: string | null;
  city?: string | null;
  country?: string | null;
  createdAt?: string | null;
  meta?: {
    leadScore?: number | null;
    outstandingBalance?: number | null;
    totalRevenue?: number | null;
    invoiceCount?: number | null;
    bookingCount?: number | null;
    lastInteractionAt?: string | null;
    nextDueTaskAt?: string | null;
  } | null;
};

export type ContactEvent = {
  id: string;
  type: string;
  createdAt: string;
  data?: unknown;
};

export type ContactNote = {
  id: string;
  body: string;
  createdAt: string;
  source?: string | null;
};

export type ContactTask = {
  id: string;
  title: string;
  status?: string | null;
  dueDate?: string | null;
};

interface ContactDetailProps {
  contact: ContactDetailData | null;
  events?: ContactEvent[];
  notes?: ContactNote[];
  tasks?: ContactTask[];
  loading?: boolean;
  isPinned?: boolean;
  onTogglePin?: (id: string) => void;
  onClose?: () => void;
  onAddNote?: (body: string) => Promise<void>;
  onAddTask?: (title: string, dueDate?: string) => Promise<void>;
  onCompleteTask?: (taskId: string) => Promise<void>;
  onUpdateStatus?: (status: string) => Promise<void>;
  onEdit?: () => void;
  onDelete?: () => Promise<void>;
}

const STATUSES = ["LEAD", "PROSPECT", "CLIENT", "LOST"] as const;

const STATUS_COLORS: Record<string, string> = {
  LEAD: "hsl(var(--kf-accent1))",
  PROSPECT: "hsl(var(--kf-accent2))",
  CLIENT: "hsl(142 76% 36%)",
  LOST: "hsl(var(--kf-muted-foreground))",
};

const SOURCE_CONFIG: Record<string, { label: string; icon: typeof Globe }> = {
  booking: { label: "Booking", icon: CalendarCheck },
  store: { label: "Store", icon: Globe },
  "lead-form": { label: "Lead Form", icon: FileText },
  import: { label: "Import", icon: Upload },
  manual: { label: "Manual", icon: UserPlus },
  google: { label: "Google", icon: Globe },
};

const QUICK_TEMPLATES = [
  { label: "Follow-up", message: "Hi {name}, just following up on our last conversation. How can I help?" },
  { label: "Thank you", message: "Hi {name}, thank you for your business! We truly appreciate it." },
  { label: "Appointment", message: "Hi {name}, this is a reminder about your upcoming appointment. See you soon!" },
  { label: "Payment", message: "Hi {name}, just a friendly reminder about your outstanding balance. Let me know if you have any questions." },
  { label: "Promo", message: "Hi {name}, we have a special offer just for you! Reply to learn more." },
];

const EVENT_LABELS: Record<string, string> = {
  "contact.created": "Contact created",
  "contact.updated": "Contact updated",
  "invoice.created": "Invoice created",
  "invoice.paid": "Invoice paid",
  "booking.created": "Booking made",
  "booking.completed": "Booking completed",
  "quote.created": "Quote sent",
  "quote.accepted": "Quote accepted",
  "note.added": "Note added",
  "task.created": "Task created",
  "task.completed": "Task completed",
  "email.sent": "Email sent",
  "form.submitted": "Form submitted",
};

export function ContactDetail({
  contact,
  events = [],
  notes = [],
  tasks = [],
  loading,
  isPinned,
  onTogglePin,
  onClose,
  onAddNote,
  onAddTask,
  onCompleteTask,
  onUpdateStatus,
  onEdit,
  onDelete,
}: ContactDetailProps) {
  const [activeTab, setActiveTab] = useState<"timeline" | "notes" | "tasks" | "compose">("timeline");
  const [newNote, setNewNote] = useState("");
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDue, setNewTaskDue] = useState("");
  const [noteLoading, setNoteLoading] = useState(false);
  const [taskLoading, setTaskLoading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [composeMessage, setComposeMessage] = useState("");
  const [copied, setCopied] = useState(false);

  const handleDelete = async () => {
    if (!onDelete) return;
    setDeleting(true);
    await onDelete();
    setDeleting(false);
    setDeleteConfirm(false);
  };

  if (loading) {
    return (
      <div className="kf-card p-6 flex items-center justify-center min-h-[300px]">
        <div className="text-muted-foreground text-sm">Loading contact...</div>
      </div>
    );
  }

  if (!contact) {
    return (
      <div className="kf-card p-6 flex flex-col items-center justify-center min-h-[300px] text-center">
        <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
          <MessageSquare className="w-8 h-8 text-muted-foreground" />
        </div>
        <p className="text-muted-foreground">Select a contact to view details</p>
      </div>
    );
  }

  const fullName = `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || "Unnamed";
  const initials = `${contact.firstName?.[0] ?? ""}${contact.lastName?.[0] ?? ""}`.toUpperCase() || "?";
  const statusColor = STATUS_COLORS[contact.status ?? ""] ?? STATUS_COLORS.LEAD;
  const waPhone = getContactPhone(contact);
  const sourceKey = (contact.source || "manual").toLowerCase().replace(/[_\s]/g, "-");
  const sourceInfo = SOURCE_CONFIG[sourceKey] || { label: contact.source || "Unknown", icon: Globe };
  const SourceIcon = sourceInfo.icon;

  const handleAddNote = async () => {
    if (!newNote.trim() || !onAddNote) return;
    setNoteLoading(true);
    await onAddNote(newNote.trim());
    setNewNote("");
    setNoteLoading(false);
  };

  const handleAddTask = async () => {
    if (!newTaskTitle.trim() || !onAddTask) return;
    setTaskLoading(true);
    await onAddTask(newTaskTitle.trim(), newTaskDue || undefined);
    setNewTaskTitle("");
    setNewTaskDue("");
    setTaskLoading(false);
  };

  const applyTemplate = (template: string) => {
    setComposeMessage(template.replace("{name}", contact.firstName || "there"));
  };

  const handleCopyMessage = () => {
    navigator.clipboard.writeText(composeMessage);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSendWhatsApp = () => {
    if (!waPhone) return;
    window.open(buildWhatsAppLink(waPhone, composeMessage), "_blank");
  };

  const handleSendEmail = () => {
    if (!contact.email) return;
    const subject = encodeURIComponent("Following up");
    const body = encodeURIComponent(composeMessage);
    window.open(`mailto:${contact.email}?subject=${subject}&body=${body}`, "_blank");
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      className="kf-card p-5 space-y-4 h-full overflow-y-auto"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className="h-14 w-14 rounded-full flex items-center justify-center text-white text-lg font-semibold flex-shrink-0"
            style={{ background: statusColor }}
          >
            {initials}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold">{fullName}</h2>
              {onTogglePin && (
                <button
                  onClick={() => onTogglePin(contact.id)}
                  className={`p-0.5 rounded transition-colors ${isPinned ? "text-yellow-400" : "text-muted-foreground hover:text-yellow-400"}`}
                  title={isPinned ? "Unpin" : "Pin contact"}
                >
                  <Star className={`w-4 h-4 ${isPinned ? "fill-current" : ""}`} />
                </button>
              )}
            </div>
            {(contact.companyName || contact.jobTitle) && (
              <p className="text-sm text-muted-foreground">
                {contact.jobTitle && contact.companyName
                  ? `${contact.jobTitle} at ${contact.companyName}`
                  : contact.companyName || contact.jobTitle}
              </p>
            )}
            <div className="flex items-center gap-2 mt-1">
              <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground">
                <SourceIcon className="w-2.5 h-2.5" />
                {sourceInfo.label}
              </span>
              {contact.createdAt && (
                <span className="text-[10px] text-muted-foreground">
                  Added {new Date(contact.createdAt).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {(onEdit || onDelete) && (
            <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1">
              {onEdit && (
                <button
                  onClick={onEdit}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 hover:bg-[hsl(var(--kf-accent2))]/20 rounded-md transition-colors text-sm"
                  title="Edit contact"
                >
                  <Pencil className="w-4 h-4 text-[hsl(var(--kf-accent2))]" />
                  <span className="hidden sm:inline text-xs text-muted-foreground">Edit</span>
                </button>
              )}
              {onDelete && (
                <button
                  onClick={() => setDeleteConfirm(true)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 hover:bg-red-500/20 rounded-md transition-colors text-sm"
                  title="Delete contact"
                >
                  <Trash2 className="w-4 h-4 text-red-400" />
                  <span className="hidden sm:inline text-xs text-red-400">Delete</span>
                </button>
              )}
            </div>
          )}
          {onClose && (
            <button onClick={onClose} className="p-1 hover:bg-muted rounded-lg transition-colors lg:hidden">
              <X className="w-5 h-5 text-muted-foreground" />
            </button>
          )}
        </div>
      </div>

      {deleteConfirm && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 space-y-3">
          <p className="text-sm text-red-400">Are you sure you want to delete this contact?</p>
          <div className="flex gap-2">
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="px-3 py-1.5 text-sm rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50"
            >
              {deleting ? "Deleting..." : "Yes, Delete"}
            </button>
            <button
              onClick={() => setDeleteConfirm(false)}
              className="px-3 py-1.5 text-sm rounded-lg bg-muted hover:bg-muted/80 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => onUpdateStatus?.(s)}
            className={`px-3 py-1 text-xs rounded-lg transition-all ${
              contact.status === s ? "kf-btn-primary" : "kf-btn-secondary"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 p-3 rounded-xl bg-muted/30 border border-border/50">
        {contact.email && (
          <a
            href={`mailto:${contact.email}`}
            className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg hover:bg-blue-500/10 transition-colors text-sm"
            title={`Email ${contact.email}`}
          >
            <Mail className="w-4 h-4 text-blue-400" />
            <span className="hidden sm:inline text-blue-400 text-xs">Email</span>
          </a>
        )}
        {contact.phone && (
          <a
            href={`tel:${contact.phone}`}
            className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg hover:bg-violet-500/10 transition-colors text-sm"
            title={`Call ${contact.phone}`}
          >
            <Phone className="w-4 h-4 text-violet-400" />
            <span className="hidden sm:inline text-violet-400 text-xs">Call</span>
          </a>
        )}
        {waPhone && (
          <a
            href={buildWhatsAppLink(waPhone, `Hi ${contact.firstName || ""},`)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg hover:bg-emerald-500/10 transition-colors text-sm"
            title="WhatsApp"
          >
            <MessageCircle className="w-4 h-4 text-emerald-500" />
            <span className="hidden sm:inline text-emerald-500 text-xs">WhatsApp</span>
          </a>
        )}
        <button
          onClick={() => setActiveTab("compose")}
          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg transition-colors text-sm ${activeTab === "compose" ? "bg-[hsl(var(--kf-accent1))]/10" : "hover:bg-[hsl(var(--kf-accent1))]/10"}`}
          title="Quick compose"
        >
          <Send className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
          <span className="hidden sm:inline text-xs" style={{ color: "hsl(var(--kf-accent1))" }}>Compose</span>
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
        <div className="kf-stat-card p-3">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            <TrendingUp className="w-3 h-3" />
            Lead Score
          </div>
          <div className="text-lg font-semibold">{contact.meta?.leadScore ?? "-"}</div>
        </div>
        <div className="kf-stat-card p-3">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            <DollarSign className="w-3 h-3" />
            Outstanding
          </div>
          <div className="text-lg font-semibold" style={{ color: (contact.meta?.outstandingBalance ?? 0) > 0 ? "hsl(var(--kf-accent1))" : undefined }}>
            {contact.meta?.outstandingBalance ? `TTD ${contact.meta.outstandingBalance.toLocaleString()}` : "-"}
          </div>
        </div>
        <div className="kf-stat-card p-3">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            <Clock className="w-3 h-3" />
            Last Activity
          </div>
          <div className="text-xs font-medium">
            {contact.meta?.lastInteractionAt
              ? new Date(contact.meta.lastInteractionAt).toLocaleDateString()
              : "No activity"}
          </div>
        </div>
        <div className="kf-stat-card p-3">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            <Calendar className="w-3 h-3" />
            Next Task
          </div>
          <div className="text-xs font-medium">
            {contact.meta?.nextDueTaskAt
              ? new Date(contact.meta.nextDueTaskAt).toLocaleDateString()
              : "None"}
          </div>
        </div>
      </div>

      {(contact.meta?.totalRevenue || contact.meta?.invoiceCount || contact.meta?.bookingCount) && (
        <div className="p-3 rounded-xl bg-muted/30 border border-border/50">
          <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wider">Financial Summary</p>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-lg font-semibold" style={{ color: "hsl(var(--kf-accent2))" }}>
                TTD {(contact.meta?.totalRevenue ?? 0).toLocaleString()}
              </p>
              <p className="text-[10px] text-muted-foreground">Total Revenue</p>
            </div>
            <div>
              <p className="text-lg font-semibold">{contact.meta?.invoiceCount ?? 0}</p>
              <p className="text-[10px] text-muted-foreground">Invoices</p>
            </div>
            <div>
              <p className="text-lg font-semibold">{contact.meta?.bookingCount ?? 0}</p>
              <p className="text-[10px] text-muted-foreground">Bookings</p>
            </div>
          </div>
        </div>
      )}

      {(contact.addressLine1 || contact.city || contact.country) && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-muted/50 text-sm">
          <MapPin className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: statusColor }} />
          <span>
            {[contact.addressLine1, contact.city, contact.country].filter(Boolean).join(", ")}
          </span>
        </div>
      )}

      {contact.tags && contact.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {contact.tags.map((tag) => (
            <span
              key={tag}
              className="text-xs px-2 py-1 rounded-lg bg-muted text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="flex border-b border-border overflow-x-auto">
        {[
          { key: "timeline", label: "Timeline", icon: History },
          { key: "notes", label: "Notes", icon: MessageSquare },
          { key: "tasks", label: "Tasks", icon: ListTodo },
          { key: "compose", label: "Compose", icon: Send },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key as typeof activeTab)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm transition-colors border-b-2 -mb-px whitespace-nowrap ${
              activeTab === key
                ? "border-[hsl(var(--kf-accent1))] text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {activeTab === "compose" && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {QUICK_TEMPLATES.map((t) => (
                <button
                  key={t.label}
                  onClick={() => applyTemplate(t.message)}
                  className="text-xs px-2.5 py-1.5 rounded-lg bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t.label}
                </button>
              ))}
            </div>
            <textarea
              placeholder={`Write a message to ${contact.firstName || "this contact"}...`}
              value={composeMessage}
              onChange={(e) => setComposeMessage(e.target.value)}
              className="kf-input w-full min-h-[100px] resize-none"
            />
            <div className="flex gap-2">
              {waPhone && (
                <button
                  onClick={handleSendWhatsApp}
                  disabled={!composeMessage.trim()}
                  className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm transition-colors disabled:opacity-50"
                >
                  <MessageCircle className="w-4 h-4" />
                  Send via WhatsApp
                </button>
              )}
              {contact.email && (
                <button
                  onClick={handleSendEmail}
                  disabled={!composeMessage.trim()}
                  className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm transition-colors disabled:opacity-50"
                >
                  <Mail className="w-4 h-4" />
                  Send via Email
                </button>
              )}
              <button
                onClick={handleCopyMessage}
                disabled={!composeMessage.trim()}
                className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-muted hover:bg-muted/80 text-sm transition-colors disabled:opacity-50"
              >
                <Copy className="w-4 h-4" />
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>
        )}

        {activeTab === "timeline" && (
          <>
            {events.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No events yet</p>
            ) : (
              <div className="relative pl-4 border-l-2 border-border/50 space-y-3">
                {events.slice(0, 20).map((event) => (
                  <div key={event.id} className="relative">
                    <div className="absolute -left-[21px] top-2 w-2.5 h-2.5 rounded-full border-2 border-border bg-background" />
                    <div className="p-3 rounded-xl bg-muted/30 border border-border/50">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">{EVENT_LABELS[event.type] || event.type}</span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(event.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {activeTab === "notes" && (
          <>
            <div className="flex gap-2">
              <textarea
                placeholder="Add a note..."
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                className="kf-input flex-1 min-h-[80px] resize-none"
              />
            </div>
            <button
              onClick={handleAddNote}
              disabled={!newNote.trim() || noteLoading}
              className="kf-btn-primary w-full flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" />
              {noteLoading ? "Adding..." : "Add Note"}
            </button>
            {notes.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No notes yet</p>
            ) : (
              notes.slice(0, 20).map((note) => (
                <div key={note.id} className="p-3 rounded-xl bg-muted/30 border border-border/50">
                  <p className="text-sm whitespace-pre-wrap">{note.body}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-xs text-muted-foreground">
                      {new Date(note.createdAt).toLocaleDateString()}
                    </p>
                    {note.source && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                        {note.source}
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </>
        )}

        {activeTab === "tasks" && (
          <>
            <div className="space-y-2">
              <input
                type="text"
                placeholder="Task title"
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                className="kf-input w-full"
              />
              <input
                type="datetime-local"
                value={newTaskDue}
                onChange={(e) => setNewTaskDue(e.target.value)}
                className="kf-input w-full"
              />
            </div>
            <button
              onClick={handleAddTask}
              disabled={!newTaskTitle.trim() || taskLoading}
              className="kf-btn-primary w-full flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" />
              {taskLoading ? "Adding..." : "Add Task"}
            </button>
            {tasks.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No tasks yet</p>
            ) : (
              tasks.slice(0, 20).map((task) => (
                <div
                  key={task.id}
                  className="p-3 rounded-xl bg-muted/30 border border-border/50 flex items-center justify-between"
                >
                  <div>
                    <p className={`text-sm font-medium ${task.status === "DONE" ? "line-through text-muted-foreground" : ""}`}>{task.title}</p>
                    {task.dueDate && (
                      <p className="text-xs text-muted-foreground">
                        Due: {new Date(task.dueDate).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  {task.status !== "DONE" && onCompleteTask && (
                    <button
                      onClick={() => onCompleteTask(task.id)}
                      className="p-2 hover:bg-muted rounded-lg transition-colors"
                    >
                      <CheckCircle2 className="w-5 h-5 text-muted-foreground hover:text-[hsl(var(--kf-accent2))]" />
                    </button>
                  )}
                  {task.status === "DONE" && (
                    <CheckCircle2 className="w-5 h-5" style={{ color: "hsl(var(--kf-accent2))" }} />
                  )}
                </div>
              ))
            )}
          </>
        )}
      </div>
    </motion.div>
  );
}
