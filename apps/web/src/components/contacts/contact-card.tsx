"use client";

import { useState, useRef, useEffect } from "react";
import React from "react";
import { motion } from "framer-motion";
import { Mail, Phone, Building2, Tag, Trash2, MessageCircle, Star, Globe, FileText, CalendarCheck, UserPlus, Upload, Sparkles, MoreHorizontal, Receipt, Calendar, FileSignature, TrendingUp, Clock } from "lucide-react";
import { buildWhatsAppLink, getContactPhone } from "@/lib/whatsapp";

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

const STATUS_COLORS: Record<string, string> = {
  LEAD: "hsl(var(--kf-accent1))",
  PROSPECT: "hsl(var(--kf-accent2))",
  CLIENT: "hsl(142 76% 36%)",
  LOST: "hsl(var(--kf-muted-foreground))",
};

const STATUS_BADGE_CLASSES: Record<string, string> = {
  LEAD: "bg-amber-500/15 text-amber-400 border-amber-500/25",
  PROSPECT: "bg-blue-500/15 text-blue-400 border-blue-500/25",
  CLIENT: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  LOST: "bg-red-500/10 text-red-400/80 border-red-500/20",
};

const STATUS_BORDER_CLASSES: Record<string, string> = {
  LEAD: "border-l-amber-500/60",
  PROSPECT: "border-l-blue-500/60",
  CLIENT: "border-l-emerald-500/60",
  LOST: "border-l-red-500/60",
};

const SCORE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  hot: { bg: "bg-red-500/15 border border-red-500/25", text: "text-red-400", label: "Hot" },
  warm: { bg: "bg-orange-500/15 border border-orange-500/25", text: "text-orange-400", label: "Warm" },
  cool: { bg: "bg-teal-500/15 border border-teal-500/25", text: "text-teal-400", label: "Cool" },
  cold: { bg: "bg-blue-500/15 border border-blue-500/25", text: "text-blue-400", label: "Cold" },
};

function getScoreStyle(score: number) {
  if (score >= 75) return SCORE_STYLES.hot;
  if (score >= 50) return SCORE_STYLES.warm;
  if (score >= 25) return SCORE_STYLES.cool;
  return SCORE_STYLES.cold;
}

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  if (diffMs < 0) return "just now";
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

const SOURCE_CONFIG: Record<string, { label: string; icon: typeof Globe; color: string }> = {
  booking: { label: "Booking", icon: CalendarCheck, color: "hsl(var(--kf-accent2))" },
  store: { label: "Store", icon: Globe, color: "hsl(280 70% 60%)" },
  "lead-form": { label: "Lead Form", icon: FileText, color: "hsl(200 70% 50%)" },
  import: { label: "Import", icon: Upload, color: "hsl(45 90% 50%)" },
  manual: { label: "Manual", icon: UserPlus, color: "hsl(var(--kf-accent1))" },
  google: { label: "Google", icon: Globe, color: "hsl(120 60% 45%)" },
  referral: { label: "Referral", icon: Sparkles, color: "hsl(320 70% 55%)" },
};

function getSourceInfo(source?: string | null) {
  if (!source) return SOURCE_CONFIG.manual;
  const key = source.toLowerCase().replace(/[_\s]/g, "-");
  return SOURCE_CONFIG[key] || { label: source, icon: Globe, color: "hsl(var(--kf-muted-foreground))" };
}

export type QuickActionType = "create-invoice" | "book-appointment" | "send-quote";

interface ContactCardProps {
  contact: ContactCardData;
  isSelected?: boolean;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
  isPinned?: boolean;
  onTogglePin?: (id: string) => void;
  onClick?: () => void;
  onDelete?: (contact: ContactCardData) => void;
  onQuickAction?: (contactId: string, action: QuickActionType) => void;
  index?: number;
}

function ContactCardInner({ contact, isSelected, selectable, selected, onToggleSelect, isPinned, onTogglePin, onClick, onDelete, onQuickAction, index = 0 }: ContactCardProps) {
  const [showActions, setShowActions] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);
  const fullName = `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || "Unnamed";
  const initials = `${contact.firstName?.[0] ?? ""}${contact.lastName?.[0] ?? ""}`.toUpperCase() || "?";
  const statusColor = STATUS_COLORS[contact.status ?? ""] ?? STATUS_COLORS.LEAD;
  const badgeClass = STATUS_BADGE_CLASSES[contact.status ?? ""] ?? "bg-muted/20 text-muted-foreground border-border/30";
  const borderClass = STATUS_BORDER_CLASSES[contact.status ?? ""] ?? "border-l-border/30";
  const sourceInfo = getSourceInfo(contact.source);
  const SourceIcon = sourceInfo.icon;

  const leadScore = contact.meta?.leadScore;
  const hasLeadScore = leadScore != null && leadScore > 0;
  const scoreStyle = hasLeadScore ? getScoreStyle(leadScore!) : null;

  const totalRevenue = contact.meta?.totalRevenue;
  const hasRevenue = totalRevenue != null && totalRevenue > 0;

  const lastInteraction = contact.meta?.lastInteractionAt;
  const hasLastInteraction = !!lastInteraction;

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

  const handlePin = (e: React.MouseEvent) => {
    e.stopPropagation();
    onTogglePin?.(contact.id);
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
      aria-label={fullName}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index < 10 ? index * 0.03 : 0 }}
      onClick={onClick}
      className={`rounded-2xl border border-l-2 ${borderClass} bg-card p-3 sm:p-4 cursor-pointer transition-all hover:bg-white/[0.02] group overflow-hidden ${
        isSelected ? "border-[hsl(var(--kf-accent1))]/50 bg-[hsl(var(--kf-accent1))]/[0.04]" : "border-border/50"
      } ${selected ? "border-[hsl(var(--kf-accent2))]/50 bg-[hsl(var(--kf-accent2))]/[0.04]" : ""}`}
    >
      <div className="flex items-start gap-2.5 sm:gap-3 min-w-0">
        {selectable && (
          <div className="flex items-center pt-1.5 flex-shrink-0">
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggleSelect?.(contact.id)}
              onClick={(e) => e.stopPropagation()}
              className="w-4 h-4 rounded border-border accent-[hsl(var(--kf-accent1))] cursor-pointer"
            />
          </div>
        )}

        <div className="flex-shrink-0">
          <div
            className="h-9 w-9 sm:h-10 sm:w-10 rounded-full flex items-center justify-center text-white text-xs font-bold"
            style={{ background: statusColor }}
          >
            {initials}
          </div>
        </div>

        <div className="flex-1 min-w-0 overflow-hidden">
          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
            <h3 className="text-sm font-semibold truncate min-w-0 flex-shrink">{fullName}</h3>
            {hasLeadScore && scoreStyle && (
              <span
                className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${scoreStyle.bg} ${scoreStyle.text} flex-shrink-0`}
                title={`Lead Score: ${leadScore} (${scoreStyle.label})`}
              >
                {leadScore}
              </span>
            )}
            {onTogglePin && (
              <button
                onClick={handlePin}
                className={`p-0.5 rounded transition-colors flex-shrink-0 ${isPinned ? "text-yellow-400" : "text-muted-foreground/50 md:opacity-0 md:group-hover:opacity-100"}`}
                title={isPinned ? "Unpin" : "Pin contact"}
                aria-label={isPinned ? "Unpin contact" : "Pin contact"}
              >
                <Star className={`w-3.5 h-3.5 ${isPinned ? "fill-current" : ""}`} />
              </button>
            )}
            <div className="flex-1" />
            <span className={`text-[10px] font-semibold px-1.5 sm:px-2 py-0.5 rounded-md border flex-shrink-0 ${badgeClass}`}>
              {contact.status ?? "LEAD"}
            </span>
          </div>

          <div className="flex items-center gap-1.5 mt-1 flex-wrap min-w-0">
            {hasRevenue && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex-shrink-0">
                <TrendingUp className="w-3 h-3 inline-block mr-0.5 -mt-px" />
                TTD {totalRevenue!.toLocaleString("en-TT")}
              </span>
            )}
            {(contact.companyName || contact.jobTitle) && (
              <p className="text-xs text-muted-foreground/70 truncate min-w-0">
                <Building2 className="w-3 h-3 inline-block mr-1 -mt-px" />
                {contact.jobTitle && contact.companyName
                  ? `${contact.jobTitle} at ${contact.companyName}`
                  : contact.companyName || contact.jobTitle}
              </p>
            )}
            {hasLastInteraction && (
              <span className="text-[10px] text-muted-foreground/50 flex items-center gap-0.5 flex-shrink-0">
                <Clock className="w-3 h-3" />
                {relativeTime(lastInteraction!)}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 mt-1.5 min-w-0">
            <span
              className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md flex-shrink-0"
              style={{ background: `${sourceInfo.color}15`, color: sourceInfo.color }}
              title={`Source: ${sourceInfo.label}${contact.sourceDetail ? ` (${contact.sourceDetail})` : ""}`}
            >
              <SourceIcon className="w-3 h-3" />
              {sourceInfo.label}
            </span>
            {contact.preferredChannel && (
              <span className="text-[10px] text-muted-foreground/60">
                via {contact.preferredChannel}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 mt-2 min-w-0 flex-wrap">
            {contact.email && (
              <a
                href={`mailto:${contact.email}`}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center justify-center w-7 h-7 rounded-lg hover:bg-blue-500/10 transition-colors flex-shrink-0"
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
                className="inline-flex items-center justify-center w-7 h-7 rounded-lg hover:bg-violet-500/10 transition-colors flex-shrink-0"
                title={`Call ${contact.phone}`}
                aria-label={`Call ${contact.phone}`}
              >
                <Phone className="w-3.5 h-3.5 text-violet-400" />
              </a>
            )}
            {(() => {
              const waPhone = getContactPhone(contact);
              if (!waPhone) return null;
              const firstName = contact.firstName || "";
              return (
                <a
                  href={buildWhatsAppLink(waPhone, `Hi ${firstName}, `)}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center justify-center w-7 h-7 rounded-lg hover:bg-emerald-500/10 transition-colors flex-shrink-0"
                  title="WhatsApp"
                  aria-label="Message on WhatsApp"
                >
                  <MessageCircle className="w-3.5 h-3.5 text-emerald-500" />
                </a>
              );
            })()}

            {onQuickAction && (
              <div className="relative flex-shrink-0" ref={actionsRef}>
                <button
                  onClick={(e) => { e.stopPropagation(); setShowActions(!showActions); }}
                  className="inline-flex items-center justify-center w-7 h-7 rounded-lg hover:bg-white/[0.06] text-muted-foreground/50 hover:text-muted-foreground transition-colors md:opacity-0 md:group-hover:opacity-100"
                  title="Quick actions"
                  aria-haspopup="menu"
                  aria-expanded={showActions}
                >
                  <MoreHorizontal className="w-3.5 h-3.5" />
                </button>
                {showActions && (
                  <div role="menu" className="absolute right-0 bottom-full mb-1 sm:bottom-auto sm:top-9 sm:mb-0 z-50 w-48 bg-popover/95 backdrop-blur-xl border border-border/50 shadow-xl rounded-xl py-1 animate-in fade-in zoom-in-95">
                    <button role="menuitem" onClick={(e) => handleQuickAction(e, "create-invoice")} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs hover:bg-white/[0.05] transition-colors">
                      <Receipt className="w-4 h-4 text-emerald-400" />
                      Create Invoice
                    </button>
                    <button role="menuitem" onClick={(e) => handleQuickAction(e, "book-appointment")} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs hover:bg-white/[0.05] transition-colors">
                      <Calendar className="w-4 h-4 text-blue-400" />
                      Book Appointment
                    </button>
                    <button role="menuitem" onClick={(e) => handleQuickAction(e, "send-quote")} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs hover:bg-white/[0.05] transition-colors">
                      <FileSignature className="w-4 h-4 text-violet-400" />
                      Send Quote
                    </button>
                  </div>
                )}
              </div>
            )}
            <button
              onClick={handleDelete}
              className="inline-flex items-center justify-center w-7 h-7 rounded-lg hover:bg-red-500/10 text-muted-foreground/40 hover:text-red-400 transition-colors md:opacity-0 md:group-hover:opacity-100 flex-shrink-0"
              title="Delete contact"
              aria-label="Delete contact"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>

            <div className="flex-1" />

            {contact.tags && contact.tags.length > 0 && (
              <div className="flex items-center gap-1 flex-shrink-0">
                {contact.tags.slice(0, 2).map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-white/[0.06] text-muted-foreground border border-border/30 max-w-[80px] truncate"
                  >
                    <Tag className="w-3 h-3 flex-shrink-0" />
                    {tag}
                  </span>
                ))}
                {contact.tags.length > 2 && (
                  <span className="text-[10px] text-muted-foreground/50 font-medium">+{contact.tags.length - 2}</span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export const ContactCard = React.memo(ContactCardInner);
