"use client";

import { useState } from "react";
import {
  Mail,
  Phone,
  Star,
  Pencil,
  Trash2,
  X,
  MessageCircle,
  Send,
  Globe,
  CalendarCheck,
  FileText,
  UserPlus,
  Upload,
  Receipt,
  Calendar,
  FileSignature,
  Copy,
  Bell,
  ChevronUp,
} from "lucide-react";
import { buildWhatsAppLink, getContactPhone } from "@/lib/whatsapp";
import type { ContactDetailData, DetailQuickAction } from "./contact-detail";

const STATUS_COLORS: Record<string, string> = {
  LEAD: "hsl(var(--kf-accent1))",
  PROSPECT: "hsl(var(--kf-accent2))",
  CLIENT: "hsl(142 76% 36%)",
  LOST: "hsl(var(--kf-muted-foreground))",
};

const STATUSES = ["LEAD", "PROSPECT", "CLIENT", "LOST"] as const;

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

const WHATSAPP_CHAR_LIMIT = 4096;

interface ContactDetailHeaderProps {
  contact: ContactDetailData;
  isPinned?: boolean;
  onTogglePin?: (id: string) => void;
  onClose?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onUpdateStatus?: (status: string) => Promise<void>;
  onQuickAction?: (contactId: string, action: DetailQuickAction) => void;
  onLogEvent?: (type: string, description?: string) => Promise<void>;
  onAddTask?: (title: string, options?: { dueDate?: string; priority?: string; remindAt?: string }) => Promise<void>;
}

export function ContactDetailHeader({
  contact,
  isPinned,
  onTogglePin,
  onClose,
  onEdit,
  onDelete,
  onUpdateStatus,
  onQuickAction,
  onLogEvent,
  onAddTask,
}: ContactDetailHeaderProps) {
  const fullName = `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || "Unnamed";
  const initials = `${contact.firstName?.[0] ?? ""}${contact.lastName?.[0] ?? ""}`.toUpperCase() || "?";
  const statusColor = STATUS_COLORS[contact.status ?? ""] ?? STATUS_COLORS.LEAD;
  const waPhone = getContactPhone(contact);
  const sourceKey = (contact.source || "manual").toLowerCase().replace(/[_\s]/g, "-");
  const sourceInfo = SOURCE_CONFIG[sourceKey] || { label: contact.source || "Unknown", icon: Globe };
  const SourceIcon = sourceInfo.icon;

  const [composeOpen, setComposeOpen] = useState(false);
  const [composeMessage, setComposeMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [followUpLoading, setFollowUpLoading] = useState(false);

  const charCount = composeMessage.length;
  const charColor = charCount > WHATSAPP_CHAR_LIMIT ? "text-red-400" : charCount > WHATSAPP_CHAR_LIMIT * 0.8 ? "text-yellow-400" : "text-muted-foreground";

  const applyTemplate = (template: string) => {
    setComposeMessage(template.replace("{name}", contact.firstName || "there"));
  };

  const handleCopyMessage = async () => {
    navigator.clipboard.writeText(composeMessage);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    onLogEvent?.("message.copied", composeMessage.slice(0, 200));
    setShowFollowUp(true);
  };

  const handleSendWhatsApp = async () => {
    if (!waPhone) return;
    window.open(buildWhatsAppLink(waPhone, composeMessage), "_blank");
    onLogEvent?.("whatsapp.sent", composeMessage.slice(0, 200));
    setShowFollowUp(true);
  };

  const handleSendEmail = async () => {
    if (!contact.email) return;
    const subject = encodeURIComponent("Following up");
    const body = encodeURIComponent(composeMessage);
    window.open(`mailto:${contact.email}?subject=${subject}&body=${body}`, "_blank");
    onLogEvent?.("email.sent", composeMessage.slice(0, 200));
    setShowFollowUp(true);
  };

  const handleFollowUp = async (days: number) => {
    if (!onAddTask) return;
    setFollowUpLoading(true);
    const due = new Date();
    due.setDate(due.getDate() + days);
    const label = days === 1 ? "tomorrow" : days === 3 ? "in 3 days" : "in 1 week";
    await onAddTask(`Follow up with ${contact.firstName || "contact"} ${label}`, { dueDate: due.toISOString(), priority: "HIGH" });
    onLogEvent?.("followup.scheduled", `Follow-up in ${days} day(s)`);
    setFollowUpLoading(false);
    setShowFollowUp(false);
  };

  return (
    <>
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
            <div className="flex items-center gap-2 mt-0.5">
              {contact.email && (
                <a href={`mailto:${contact.email}`} className="text-xs text-blue-400 hover:underline truncate max-w-[180px]" title={contact.email}>
                  {contact.email}
                </a>
              )}
              {contact.email && contact.phone && <span className="text-muted-foreground text-[10px]">·</span>}
              {contact.phone && (
                <a href={`tel:${contact.phone}`} className="text-xs text-violet-400 hover:underline" title={contact.phone}>
                  {contact.phone}
                </a>
              )}
            </div>
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
                  onClick={onDelete}
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

      <div className="rounded-xl bg-muted/30 border border-border/50 overflow-hidden">
        <div className="flex items-center gap-2 p-3">
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
            onClick={() => setComposeOpen(!composeOpen)}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg transition-colors text-sm ${
              composeOpen ? "bg-[hsl(var(--kf-accent1))]/15" : "hover:bg-[hsl(var(--kf-accent1))]/10"
            }`}
            title="Quick compose"
          >
            {composeOpen ? (
              <ChevronUp className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
            ) : (
              <Send className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
            )}
            <span className="hidden sm:inline text-xs" style={{ color: "hsl(var(--kf-accent1))" }}>
              {composeOpen ? "Close" : "Compose"}
            </span>
          </button>
        </div>

        {composeOpen && (
          <div className="px-3 pb-3 space-y-2 border-t border-border/50 pt-2">
            <div className="flex flex-wrap gap-1">
              {QUICK_TEMPLATES.map((t) => (
                <button
                  key={t.label}
                  onClick={() => applyTemplate(t.message)}
                  className="text-[10px] px-2 py-1 rounded-md bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="relative">
              <textarea
                placeholder={`Write a message to ${contact.firstName || "this contact"}...`}
                value={composeMessage}
                onChange={(e) => setComposeMessage(e.target.value)}
                className="kf-input w-full min-h-[80px] resize-none text-sm"
                autoFocus
              />
              {charCount > 0 && (
                <span className={`absolute bottom-2 right-2 text-[10px] ${charColor}`}>
                  {charCount.toLocaleString()}/{WHATSAPP_CHAR_LIMIT.toLocaleString()}
                </span>
              )}
            </div>
            <div className="flex gap-1.5">
              {waPhone && (
                <button
                  onClick={handleSendWhatsApp}
                  disabled={!composeMessage.trim()}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs transition-colors disabled:opacity-50"
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                  WhatsApp
                </button>
              )}
              {contact.email && (
                <button
                  onClick={handleSendEmail}
                  disabled={!composeMessage.trim()}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs transition-colors disabled:opacity-50"
                >
                  <Mail className="w-3.5 h-3.5" />
                  Email
                </button>
              )}
              <button
                onClick={handleCopyMessage}
                disabled={!composeMessage.trim()}
                className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted hover:bg-muted/80 text-xs transition-colors disabled:opacity-50"
              >
                <Copy className="w-3.5 h-3.5" />
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            {showFollowUp && onAddTask && (
              <div className="p-2.5 rounded-lg bg-[hsl(var(--kf-accent1))]/10 border border-[hsl(var(--kf-accent1))]/30 space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-medium">
                  <Bell className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
                  Remind me to follow up
                </div>
                <div className="flex gap-1.5">
                  {[
                    { label: "Tomorrow", days: 1 },
                    { label: "In 3 days", days: 3 },
                    { label: "In 1 week", days: 7 },
                  ].map((opt) => (
                    <button
                      key={opt.days}
                      onClick={() => handleFollowUp(opt.days)}
                      disabled={followUpLoading}
                      className="flex-1 px-2 py-1 text-[10px] rounded-md bg-muted hover:bg-muted/80 transition-colors disabled:opacity-50"
                    >
                      {opt.label}
                    </button>
                  ))}
                  <button
                    onClick={() => setShowFollowUp(false)}
                    className="px-2 py-1 text-[10px] rounded-md text-muted-foreground hover:bg-muted transition-colors"
                  >
                    Skip
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {onQuickAction && (
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => onQuickAction(contact.id, "create-invoice")}
            className="flex items-center justify-center gap-1.5 p-2 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-xs font-medium transition-colors"
          >
            <Receipt className="w-3.5 h-3.5" />
            Invoice
          </button>
          <button
            onClick={() => onQuickAction(contact.id, "book-appointment")}
            className="flex items-center justify-center gap-1.5 p-2 rounded-xl bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 text-xs font-medium transition-colors"
          >
            <Calendar className="w-3.5 h-3.5" />
            Book
          </button>
          <button
            onClick={() => onQuickAction(contact.id, "send-quote")}
            className="flex items-center justify-center gap-1.5 p-2 rounded-xl bg-violet-500/10 hover:bg-violet-500/20 text-violet-400 text-xs font-medium transition-colors"
          >
            <FileSignature className="w-3.5 h-3.5" />
            Quote
          </button>
        </div>
      )}
    </>
  );
}
