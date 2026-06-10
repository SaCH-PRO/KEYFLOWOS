"use client";

import { useState, useEffect, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Mail,
  Phone,
  Star,
  Pencil,
  Trash2,
  X,
  MessageCircle,
  Globe,
  CalendarCheck,
  FileText,
  UserPlus,
  Upload,
  Receipt,
  Calendar,
  FileSignature,
  CheckCircle2,
  ArrowRight,
  ListTodo,
  Zap,
} from "lucide-react";
import { buildWhatsAppLink, getContactPhone } from "@/lib/whatsapp";
import type { ContactDetailData, DetailQuickAction } from "./contact-detail";
import { DataQualityBadge } from "./data-quality-badge";
import { ContactAvatar } from "./contact-avatar";

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

const STAGE_CONSEQUENCES: Record<string, { suggestion: string; taskLabel: string; hint: string }> = {
  LEAD: {
    suggestion: "Send an introductory message to warm up this lead",
    taskLabel: "Send intro to {name}",
    hint: "New leads convert best when contacted within 24 hours",
  },
  PROSPECT: {
    suggestion: "Schedule a discovery call or send a proposal",
    taskLabel: "Follow up with prospect {name}",
    hint: "Prospects benefit from a personalized offer within 2 days",
  },
  CLIENT: {
    suggestion: "Send a welcome message and onboard this client",
    taskLabel: "Onboard client {name}",
    hint: "Great! Set up their first booking or invoice to get started",
  },
  LOST: {
    suggestion: "Log the reason for loss and schedule a re-engagement check",
    taskLabel: "Re-engage {name} in 30 days",
    hint: "Consider a win-back campaign after 30 days",
  },
};

type CommChannel = "email" | "call" | "whatsapp";

function getPrimaryChannel(contact: ContactDetailData): CommChannel {
  const pref = contact.preferredChannel?.toLowerCase();
  if (pref === "whatsapp" && getContactPhone(contact)) return "whatsapp";
  if (pref === "email" && contact.email) return "email";
  if (pref === "phone" && contact.phone) return "call";

  const hasOverdueInvoice = (contact.meta?.outstandingBalance ?? 0) > 0;
  if (hasOverdueInvoice && contact.email) return "email";

  if (getContactPhone(contact)) return "whatsapp";
  if (contact.email) return "email";
  return "call";
}

function inboxComposeHref(email: string): string {
  return `/app/inbox?compose=1&to=${encodeURIComponent(email)}`;
}

function getContextHint(contact: ContactDetailData, nextBookingDate?: string | null): string | null {
  const balance = contact.meta?.outstandingBalance ?? 0;
  if (balance > 0) return `Outstanding balance — send a payment reminder`;

  const nextTask = contact.meta?.nextDueTaskAt;
  if (nextTask) {
    const due = new Date(nextTask);
    const now = new Date();
    const diffDays = Math.ceil((due.getTime() - now.getTime()) / 86400000);
    if (diffDays <= 0) return "Overdue task — follow up now";
    if (diffDays <= 1) return "Task due today — reach out";
  }

  if (nextBookingDate) {
    const bookingDate = new Date(nextBookingDate);
    const now = new Date();
    if (bookingDate.getTime() > now.getTime()) {
      const diffDays = Math.ceil((bookingDate.getTime() - now.getTime()) / 86400000);
      if (diffDays <= 1) return "Booking tomorrow — confirm details";
      if (diffDays <= 3) return `Booking in ${diffDays} days — confirm details`;
    }
  }

  return null;
}

interface ContactDetailHeaderProps {
  contact: ContactDetailData;
  isPinned?: boolean;
  onTogglePin?: (id: string) => void;
  onClose?: () => void;
  businessId?: string | null;
  onEdit?: () => void;
  onDelete?: () => void;
  onExport?: () => void;
  onForget?: () => void;
  onUpdateStatus?: (status: string) => Promise<void>;
  onQuickAction?: (contactId: string, action: DetailQuickAction) => void;
  onAddTask?: (title: string, options?: { dueDate?: string; priority?: string; remindAt?: string }) => Promise<void>;
  nextBookingDate?: string | null;
}

export function ContactDetailHeader({
  contact,
  isPinned,
  onTogglePin,
  onClose,
  businessId,
  onEdit,
  onDelete,
  onExport,
  onForget,
  onUpdateStatus,
  onQuickAction,
  onAddTask,
  nextBookingDate,
}: ContactDetailHeaderProps) {
  const fullName = `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || "Unnamed";
  const waPhone = getContactPhone(contact);
  const sourceKey = (contact.source || "manual").toLowerCase().replace(/[_\s]/g, "-");
  const sourceInfo = SOURCE_CONFIG[sourceKey] || { label: contact.source || "Unknown", icon: Globe };
  const SourceIcon = sourceInfo.icon;

  const [stageChange, setStageChange] = useState<{ from: string; to: string } | null>(null);
  const [stageTaskCreated, setStageTaskCreated] = useState(false);

  const primaryChannel = getPrimaryChannel(contact);
  const contextHint = getContextHint(contact, nextBookingDate);

  useEffect(() => {
    if (stageChange) {
      const timer = setTimeout(() => setStageChange(null), 8000);
      return () => clearTimeout(timer);
    }
  }, [stageChange]);

  const handleStatusChange = useCallback(async (newStatus: string) => {
    if (!onUpdateStatus || newStatus === contact.status) return;
    const previousStatus = contact.status || "LEAD";
    await onUpdateStatus(newStatus);
    setStageChange({ from: previousStatus, to: newStatus });
    setStageTaskCreated(false);
  }, [onUpdateStatus, contact.status]);

  const handleStageTask = useCallback(async () => {
    if (!onAddTask || !stageChange) return;
    const consequence = STAGE_CONSEQUENCES[stageChange.to];
    if (!consequence) return;
    const due = new Date();
    due.setDate(due.getDate() + 2);
    await onAddTask(
      consequence.taskLabel.replace("{name}", contact.firstName || "client"),
      { dueDate: due.toISOString(), priority: "HIGH" }
    );
    setStageTaskCreated(true);
  }, [onAddTask, stageChange, contact.firstName]);

  const channelStyles = (channel: CommChannel, isPrimary: boolean) => {
    const base = "flex-1 flex items-center justify-center gap-2 py-2 rounded-lg transition-all text-sm";
    if (!isPrimary) return base;
    return `${base} ring-1 ring-inset`;
  };

  const channelRingColor = (channel: CommChannel): string => {
    switch (channel) {
      case "email": return "ring-blue-400/40";
      case "call": return "ring-violet-400/40";
      case "whatsapp": return "ring-emerald-500/40";
      default: return "ring-[hsl(var(--kf-accent1))]/40";
    }
  };

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <ContactAvatar contact={contact} size="lg" />
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold">{fullName}</h2>
              {businessId && (
                <DataQualityBadge businessId={businessId} contactId={contact.id} score={contact.dataQualityScore ?? null} />
              )}
              {onTogglePin && (
                <button
                  onClick={() => onTogglePin(contact.id)}
                  className={`p-0.5 rounded transition-colors ${isPinned ? "text-yellow-400" : "text-muted-foreground hover:text-yellow-400"}`}
                  title={isPinned ? "Unpin" : "Pin client"}
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
                <a
                  href={inboxComposeHref(contact.email)}
                  className="text-xs text-blue-400 hover:underline truncate max-w-[180px] text-left"
                  title={`Email ${contact.email}`}
                >
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
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground">
                <SourceIcon className="w-2.5 h-2.5" />
                {sourceInfo.label}
              </span>
              {contact.lifecycleStage && (
                <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-[hsl(var(--kf-accent2))]/15 text-[hsl(var(--kf-accent2))] border border-[hsl(var(--kf-accent2))]/30">
                  {contact.lifecycleStage}
                </span>
              )}
              {(() => {
                const fields = [contact.firstName, contact.lastName, contact.email, contact.phone, contact.companyName, contact.jobTitle, contact.department, contact.industry, contact.addressLine1, contact.city, contact.country, contact.lifecycleStage, contact.segment];
                const filled = fields.filter(Boolean).length;
                const pct = Math.round((filled / fields.length) * 100);
                const pctColor = pct >= 75 ? "text-emerald-400" : pct >= 50 ? "text-amber-400" : "text-red-400";
                return (
                  <span className={`text-[10px] font-medium ${pctColor}`} title="Data completeness">
                    {pct}% complete
                  </span>
                );
              })()}
              {contact.meta?.lastInteractionAt && (() => {
                // eslint-disable-next-line react-hooks/purity -- audited: time-relative last-active label
                const days = Math.floor((Date.now() - new Date(contact.meta.lastInteractionAt).getTime()) / 86400000);
                const label = days === 0 ? "Today" : days === 1 ? "1 day ago" : `${days}d ago`;
                const color = days > 30 ? "text-red-400" : days > 14 ? "text-amber-400" : "text-muted-foreground";
                return (
                  <span className={`text-[10px] ${color}`} title="Last interaction">
                    Last active: {label}
                  </span>
                );
              })()}
              {contact.createdAt && (
                <span className="text-[10px] text-muted-foreground">
                  Added {new Date(contact.createdAt).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {(onEdit || onDelete || onExport || onForget) && (
            <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1">
              {onEdit && (
                <button
                  onClick={onEdit}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 hover:bg-[hsl(var(--kf-accent2))]/20 rounded-md transition-colors text-sm"
                  title="Edit client"
                >
                  <Pencil className="w-4 h-4 text-[hsl(var(--kf-accent2))]" />
                  <span className="hidden sm:inline text-xs text-muted-foreground">Edit</span>
                </button>
              )}
              {onExport && (
                <button
                  onClick={onExport}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 hover:bg-blue-500/20 rounded-md transition-colors text-sm"
                  title="Export contact data (GDPR)"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-blue-400"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  <span className="hidden sm:inline text-xs text-blue-400">Export</span>
                </button>
              )}
              {onForget && (
                <button
                  onClick={onForget}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 hover:bg-orange-500/20 rounded-md transition-colors text-sm"
                  title="Forget contact (GDPR right-to-be-forgotten)"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-orange-400"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="9" y1="12" x2="15" y2="12"/></svg>
                  <span className="hidden sm:inline text-xs text-orange-400">Forget</span>
                </button>
              )}
              {onDelete && (
                <button
                  onClick={onDelete}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 hover:bg-red-500/20 rounded-md transition-colors text-sm"
                  title="Delete client"
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

      <div className="grid grid-cols-4 gap-1.5">
        {STATUSES.map((s) => {
          const isActive = contact.status === s;
          const color = STATUS_COLORS[s] ?? STATUS_COLORS.LEAD;
          return (
            <button
              key={s}
              onClick={() => handleStatusChange(s)}
              className={`relative flex items-center justify-center py-2 text-xs font-semibold rounded-xl transition-all ${
                isActive
                  ? "text-white shadow-sm"
                  : "bg-white/[0.03] border border-border/50 text-muted-foreground hover:bg-white/[0.06] hover:border-border/70"
              }`}
              style={isActive ? { backgroundColor: color } : undefined}
            >
              {s.charAt(0) + s.slice(1).toLowerCase()}
              {isActive && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-white/80 ring-2 ring-card" />
              )}
            </button>
          );
        })}
      </div>

      <AnimatePresence>
        {stageChange && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div
              className="rounded-xl p-3 space-y-2 border"
              style={{
                backgroundColor: `${STATUS_COLORS[stageChange.to] ?? "hsl(var(--kf-accent1))"}10`,
                borderColor: `${STATUS_COLORS[stageChange.to] ?? "hsl(var(--kf-accent1))"}30`,
              }}
            >
              <div className="flex items-center gap-2 text-xs font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" style={{ color: STATUS_COLORS[stageChange.to] }} />
                <span>
                  Stage changed: {stageChange.from.charAt(0) + stageChange.from.slice(1).toLowerCase()}
                  {" "}<ArrowRight className="w-3 h-3 inline" />{" "}
                  <span className="font-semibold" style={{ color: STATUS_COLORS[stageChange.to] }}>
                    {stageChange.to.charAt(0) + stageChange.to.slice(1).toLowerCase()}
                  </span>
                </span>
              </div>
              {STAGE_CONSEQUENCES[stageChange.to] && (
                <>
                  <div className="flex items-start gap-2 text-[11px] text-muted-foreground">
                    <Zap className="w-3 h-3 mt-0.5 flex-shrink-0" style={{ color: STATUS_COLORS[stageChange.to] }} />
                    <span>{STAGE_CONSEQUENCES[stageChange.to].suggestion}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground/70 italic pl-5">
                    {STAGE_CONSEQUENCES[stageChange.to].hint}
                  </p>
                  {onAddTask && !stageTaskCreated && (
                    <button
                      onClick={handleStageTask}
                      className="flex items-center gap-1.5 text-[10px] font-medium px-2.5 py-1.5 rounded-lg transition-colors ml-5"
                      style={{
                        backgroundColor: `${STATUS_COLORS[stageChange.to]}15`,
                        color: STATUS_COLORS[stageChange.to],
                      }}
                    >
                      <ListTodo className="w-3 h-3" />
                      Create follow-up task
                    </button>
                  )}
                  {stageTaskCreated && (
                    <div className="flex items-center gap-1.5 text-[10px] text-emerald-400 ml-5">
                      <CheckCircle2 className="w-3 h-3" />
                      Task created
                    </div>
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {contextHint && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[hsl(var(--kf-accent1))]/5 border border-[hsl(var(--kf-accent1))]/15 text-[10px] text-[hsl(var(--kf-accent1))]">
          <Zap className="w-3 h-3 flex-shrink-0" />
          <span>{contextHint}</span>
        </div>
      )}

      <div className="rounded-xl bg-muted/30 border border-border/50 overflow-hidden">
        <div className="flex items-center gap-2 p-3">
          {contact.email && (
            <a
              href={inboxComposeHref(contact.email)}
              className={`${channelStyles("email", primaryChannel === "email")} hover:bg-blue-500/10 ${primaryChannel === "email" ? `bg-blue-500/5 ${channelRingColor("email")}` : ""}`}
              title={`Email ${contact.email}`}
            >
              <Mail className="w-4 h-4 text-blue-400" />
              <span className="hidden sm:inline text-blue-400 text-xs">Email</span>
            </a>
          )}
          {contact.phone ? (
            <a
              href={`tel:${contact.phone}`}
              className={`${channelStyles("call", primaryChannel === "call")} hover:bg-violet-500/10 ${primaryChannel === "call" ? `bg-violet-500/5 ${channelRingColor("call")}` : ""}`}
              title={`Call ${contact.phone}`}
            >
              <Phone className="w-4 h-4 text-violet-400" />
              <span className="hidden sm:inline text-violet-400 text-xs">Call</span>
            </a>
          ) : (
            <span
              className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm opacity-30 cursor-not-allowed"
              title="No phone number"
            >
              <Phone className="w-4 h-4 text-muted-foreground" />
              <span className="hidden sm:inline text-muted-foreground text-xs">Call</span>
            </span>
          )}
          {waPhone ? (
            <a
              href={buildWhatsAppLink(waPhone, `Hi ${contact.firstName || ""},`)}
              target="_blank"
              rel="noopener noreferrer"
              className={`${channelStyles("whatsapp", primaryChannel === "whatsapp")} hover:bg-emerald-500/10 ${primaryChannel === "whatsapp" ? `bg-emerald-500/5 ${channelRingColor("whatsapp")}` : ""}`}
              title="WhatsApp"
            >
              <MessageCircle className="w-4 h-4 text-emerald-500" />
              <span className="hidden sm:inline text-emerald-500 text-xs">WhatsApp</span>
            </a>
          ) : !contact.phone ? null : (
            <span
              className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm opacity-30 cursor-not-allowed"
              title="No WhatsApp number"
            >
              <MessageCircle className="w-4 h-4 text-muted-foreground" />
              <span className="hidden sm:inline text-muted-foreground text-xs">WhatsApp</span>
            </span>
          )}
        </div>
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
