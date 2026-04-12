"use client";

import { useState, useRef, useEffect } from "react";
import React from "react";
import { motion } from "framer-motion";
import { Mail, Phone, Tag, Trash2, MessageCircle, MoreHorizontal, Receipt, Calendar, FileSignature, TrendingUp, Clock, AlertCircle, DollarSign } from "lucide-react";
import { buildWhatsAppLink, getContactPhone } from "@/lib/whatsapp";
import { relativeTime, getScoreStyle, STATUS_COLORS } from "@/lib/crm-utils";

export type ContactCardData = {
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
  } | null;
};

const STATUS_DOT_COLORS: Record<string, string> = {
  LEAD: "bg-blue-400",
  PROSPECT: "bg-amber-400",
  CLIENT: "bg-emerald-400",
  LOST: "bg-muted-foreground/50",
  VIP: "bg-violet-400",
  INACTIVE: "bg-muted-foreground/30",
};

const STAGE_BADGE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  LEAD: { bg: "bg-blue-500/10", text: "text-blue-400", label: "Lead" },
  PROSPECT: { bg: "bg-amber-500/10", text: "text-amber-400", label: "Prospect" },
  CLIENT: { bg: "bg-emerald-500/10", text: "text-emerald-400", label: "Client" },
  LOST: { bg: "bg-muted/30", text: "text-muted-foreground/60", label: "Lost" },
  VIP: { bg: "bg-violet-500/10", text: "text-violet-400", label: "VIP" },
};

export type QuickActionType = "create-invoice" | "book-appointment" | "send-quote";

interface ContactCardProps {
  contact: ContactCardData;
  isSelected?: boolean;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
  isPinned?: boolean;
  onTogglePin?: (id: string) => void;
  isFavorite?: boolean;
  onToggleFavorite?: (id: string) => void;
  onClick?: () => void;
  onDelete?: (contact: ContactCardData) => void;
  onQuickAction?: (contactId: string, action: QuickActionType) => void;
  index?: number;
}

function ContactCardInner({ contact, isSelected, selectable, selected, onToggleSelect, onClick, onDelete, onQuickAction, index = 0 }: ContactCardProps) {
  const [showActions, setShowActions] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);
  const fullName = `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || "Unnamed";
  const initials = `${contact.firstName?.[0] ?? ""}${contact.lastName?.[0] ?? ""}`.toUpperCase() || "?";
  const statusColor = STATUS_COLORS[contact.status ?? ""] ?? STATUS_COLORS.LEAD;
  const statusDot = STATUS_DOT_COLORS[contact.status ?? ""] ?? "bg-blue-400";

  const leadScore = contact.meta?.leadScore;
  const hasLeadScore = leadScore != null && leadScore > 0;
  const scoreStyle = hasLeadScore ? getScoreStyle(leadScore!) : null;

  const lastInteraction = contact.meta?.lastInteractionAt;
  const outstandingBalance = contact.meta?.outstandingBalance;
  const hasOutstanding = outstandingBalance != null && outstandingBalance > 0;
  const totalRevenue = contact.meta?.totalRevenue;
  const isHighValue = (totalRevenue != null && totalRevenue > 500) || (contact.meta?.invoiceCount != null && contact.meta.invoiceCount > 3);
  const hasBookings = contact.meta?.bookingCount != null && contact.meta.bookingCount > 0;
  const stageBadge = STAGE_BADGE_STYLES[contact.status ?? ""] ?? STAGE_BADGE_STYLES.LEAD;
  const nextDueTask = (contact as any).meta?.nextDueTaskAt;
  const hasOverdueTask = nextDueTask ? new Date(nextDueTask) < new Date() : false;

  const waPhone = getContactPhone(contact);

  useEffect(() => {
    if (!showActions) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) setShowActions(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showActions]);

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete?.(contact);
  };

  const handleQuickAction = (e: React.MouseEvent, action: QuickActionType) => {
    e.stopPropagation();
    setShowActions(false);
    onQuickAction?.(contact.id, action);
  };

  return (
    <motion.div
      role="option"
      aria-selected={isSelected || selected || false}
      aria-label={`${fullName} - ${contact.status ?? "LEAD"}`}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index < 10 ? index * 0.02 : 0 }}
      onClick={onClick}
      className={`rounded-xl border bg-card px-3 py-2 cursor-pointer transition-all hover:bg-white/[0.02] group ${
        isSelected ? "border-[hsl(var(--kf-accent1))]/50 bg-[hsl(var(--kf-accent1))]/[0.04]" : "border-border/40"
      } ${selected ? "border-[hsl(var(--kf-accent2))]/50 bg-[hsl(var(--kf-accent2))]/[0.04]" : ""}`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        {selectable && (
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect?.(contact.id)}
            onClick={(e) => e.stopPropagation()}
            className="w-4 h-4 rounded border-border accent-[hsl(var(--kf-accent1))] cursor-pointer flex-shrink-0"
          />
        )}

        <div
          className="h-8 w-8 rounded-full flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0"
          style={{ background: statusColor }}
        >
          {initials}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <h3 className="text-sm font-semibold truncate">{fullName}</h3>
            <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-md ${stageBadge.bg} ${stageBadge.text} flex-shrink-0`}>
              {stageBadge.label}
            </span>
            {isHighValue && (
              <span className="flex items-center gap-0.5 text-[9px] font-medium px-1 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 flex-shrink-0" title="High Value">
                <TrendingUp className="w-2.5 h-2.5" />
              </span>
            )}
            {hasLeadScore && scoreStyle && (
              <span
                className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md ${scoreStyle.bg} ${scoreStyle.text} flex-shrink-0`}
                title={`Lead Score: ${leadScore}`}
              >
                {leadScore}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5 min-w-0 flex-wrap">
            {(contact.companyName || contact.jobTitle) && (
              <span className="text-xs text-muted-foreground/70 truncate min-w-0">
                {contact.companyName || contact.jobTitle}
              </span>
            )}
            {lastInteraction && (
              <span className="text-[10px] text-muted-foreground/50 flex items-center gap-0.5 flex-shrink-0">
                <Clock className="w-2.5 h-2.5" />
                {relativeTime(lastInteraction)}
              </span>
            )}
            {hasOutstanding && (
              <span className="text-[10px] text-red-400/80 flex items-center gap-0.5 flex-shrink-0" title={`Outstanding: $${outstandingBalance?.toFixed(0)}`}>
                <DollarSign className="w-2.5 h-2.5" />
                {outstandingBalance?.toFixed(0)}
              </span>
            )}
            {hasBookings && (
              <span className="text-[10px] text-blue-400/70 flex items-center gap-0.5 flex-shrink-0" title={`${contact.meta?.bookingCount} booking(s)`}>
                <Calendar className="w-2.5 h-2.5" />
                {contact.meta?.bookingCount}
              </span>
            )}
            {hasOverdueTask && (
              <span className="text-[10px] text-[hsl(var(--kf-accent1))]/80 flex items-center gap-0.5 flex-shrink-0" title="Overdue task">
                <AlertCircle className="w-2.5 h-2.5" />
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-0.5 flex-shrink-0">
          {contact.email && (
            <a
              href={`mailto:${contact.email}`}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] sm:w-7 sm:h-7 sm:min-w-0 sm:min-h-0 rounded-lg hover:bg-blue-500/10 transition-colors"
              title={`Email ${contact.email}`}
              aria-label={`Email ${contact.email}`}
            >
              <Mail className="w-3.5 h-3.5 text-blue-400" />
            </a>
          )}
          {contact.phone && (
            <a
              href={`tel:${contact.phone}`}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] sm:w-7 sm:h-7 sm:min-w-0 sm:min-h-0 rounded-lg hover:bg-violet-500/10 transition-colors md:opacity-0 md:group-hover:opacity-100"
              title={`Call ${contact.phone}`}
              aria-label={`Call ${contact.phone}`}
            >
              <Phone className="w-3.5 h-3.5 text-violet-400" />
            </a>
          )}
          {waPhone && (
            <a
              href={buildWhatsAppLink(waPhone, `Hi ${contact.firstName || ""}, `)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] sm:w-7 sm:h-7 sm:min-w-0 sm:min-h-0 rounded-lg hover:bg-emerald-500/10 transition-colors md:opacity-0 md:group-hover:opacity-100"
              title="WhatsApp"
              aria-label="Message on WhatsApp"
            >
              <MessageCircle className="w-3.5 h-3.5 text-emerald-500" />
            </a>
          )}

          {onQuickAction && (
            <div className="relative flex-shrink-0" ref={actionsRef}>
              <button
                onClick={(e) => { e.stopPropagation(); setShowActions(!showActions); }}
                className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] sm:w-7 sm:h-7 sm:min-w-0 sm:min-h-0 rounded-lg hover:bg-white/[0.06] text-muted-foreground/50 hover:text-muted-foreground transition-colors md:opacity-0 md:group-hover:opacity-100"
                title="Quick actions"
                aria-haspopup="menu"
                aria-expanded={showActions}
              >
                <MoreHorizontal className="w-3.5 h-3.5" />
              </button>
              {showActions && (
                <div role="menu" className="absolute right-0 bottom-full mb-1 sm:bottom-auto sm:top-9 sm:mb-0 z-50 w-44 bg-popover/95 backdrop-blur-xl border border-border/50 shadow-xl rounded-xl py-1 animate-in fade-in zoom-in-95">
                  <button role="menuitem" onClick={(e) => handleQuickAction(e, "create-invoice")} className="w-full flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-white/[0.05] transition-colors">
                    <Receipt className="w-3.5 h-3.5 text-emerald-400" />
                    Create Invoice
                  </button>
                  <button role="menuitem" onClick={(e) => handleQuickAction(e, "book-appointment")} className="w-full flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-white/[0.05] transition-colors">
                    <Calendar className="w-3.5 h-3.5 text-blue-400" />
                    Book Appointment
                  </button>
                  <button role="menuitem" onClick={(e) => handleQuickAction(e, "send-quote")} className="w-full flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-white/[0.05] transition-colors">
                    <FileSignature className="w-3.5 h-3.5 text-violet-400" />
                    Send Quote
                  </button>
                  <hr className="my-1 border-border/30" />
                  <button role="menuitem" onClick={handleDelete} className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </button>
                </div>
              )}
            </div>
          )}
          {!onQuickAction && onDelete && (
            <button
              onClick={handleDelete}
              className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] sm:w-7 sm:h-7 sm:min-w-0 sm:min-h-0 rounded-lg hover:bg-red-500/10 text-muted-foreground/40 hover:text-red-400 transition-colors md:opacity-0 md:group-hover:opacity-100 flex-shrink-0"
              title="Delete contact"
              aria-label="Delete contact"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {contact.tags && contact.tags.length > 0 && (
        <div className="flex items-center gap-1 mt-1.5 ml-[42px] min-w-0">
          {contact.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-white/[0.05] text-muted-foreground/70 max-w-[80px] truncate"
            >
              <Tag className="w-2.5 h-2.5 flex-shrink-0" />
              {tag}
            </span>
          ))}
          {contact.tags.length > 3 && (
            <span className="text-[10px] text-muted-foreground/40">+{contact.tags.length - 3}</span>
          )}
        </div>
      )}
    </motion.div>
  );
}

export const ContactCard = React.memo(ContactCardInner);
