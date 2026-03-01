"use client";

import { useState, useRef, useEffect } from "react";
import React from "react";
import { motion } from "framer-motion";
import { Mail, Phone, Building2, Tag, Trash2, MessageCircle, Star, Globe, FileText, CalendarCheck, UserPlus, Upload, Sparkles, MoreHorizontal, Receipt, Calendar, FileSignature } from "lucide-react";
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
  } | null;
};

const STATUS_COLORS: Record<string, string> = {
  LEAD: "hsl(var(--kf-accent1))",
  PROSPECT: "hsl(var(--kf-accent2))",
  CLIENT: "hsl(142 76% 36%)",
  LOST: "hsl(var(--kf-muted-foreground))",
};

const STATUS_BADGE_CLASSES: Record<string, string> = {
  LEAD: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  PROSPECT: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  CLIENT: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  LOST: "bg-red-500/10 text-red-400/70 border-red-500/15",
};

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
  const badgeClass = STATUS_BADGE_CLASSES[contact.status ?? ""] ?? "bg-muted/30 text-muted-foreground border-border/30";
  const sourceInfo = getSourceInfo(contact.source);
  const SourceIcon = sourceInfo.icon;

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

  const handleSelect = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleSelect?.(contact.id);
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
      className={`rounded-2xl border bg-card p-4 cursor-pointer transition-all hover:bg-white/[0.01] group ${
        isSelected ? "border-[hsl(var(--kf-accent1))]/40 bg-[hsl(var(--kf-accent1))]/[0.03]" : "border-border/50"
      } ${selected ? "border-[hsl(var(--kf-accent2))]/40 bg-[hsl(var(--kf-accent2))]/[0.03]" : ""}`}
    >
      <div className="flex items-start gap-3">
        {selectable && (
          <div className="flex items-center pt-1">
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggleSelect?.(contact.id)}
              onClick={(e) => e.stopPropagation()}
              className="w-3.5 h-3.5 rounded border-border accent-[hsl(var(--kf-accent1))] cursor-pointer"
            />
          </div>
        )}

        <div
          className="h-10 w-10 rounded-xl flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
          style={{ background: `linear-gradient(135deg, ${statusColor}, ${statusColor}cc)` }}
        >
          {initials}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="text-[13px] font-semibold truncate">{fullName}</h3>
              {onTogglePin && (
                <button
                  onClick={handlePin}
                  className={`p-0.5 rounded transition-colors flex-shrink-0 ${isPinned ? "text-yellow-400" : "text-muted-foreground/30 md:opacity-0 md:group-hover:opacity-100"}`}
                  title={isPinned ? "Unpin" : "Pin contact"}
                  aria-label={isPinned ? "Unpin contact" : "Pin contact"}
                >
                  <Star className={`w-3 h-3 ${isPinned ? "fill-current" : ""}`} />
                </button>
              )}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {onQuickAction && (
                <div className="relative" ref={actionsRef}>
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowActions(!showActions); }}
                    className="p-1 rounded-lg hover:bg-white/[0.04] text-muted-foreground/40 hover:text-muted-foreground transition-colors md:opacity-0 md:group-hover:opacity-100 min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 flex items-center justify-center"
                    title="Quick actions"
                    aria-haspopup="menu"
                    aria-expanded={showActions}
                  >
                    <MoreHorizontal className="w-3.5 h-3.5" />
                  </button>
                  {showActions && (
                    <div role="menu" className="absolute right-0 top-8 z-50 w-48 bg-popover/95 backdrop-blur-xl border border-border/50 shadow-xl rounded-xl py-1 animate-in fade-in zoom-in-95">
                      <button role="menuitem" onClick={(e) => handleQuickAction(e, "create-invoice")} className="w-full flex items-center gap-2 px-3 py-2 text-[11px] hover:bg-white/[0.05] transition-colors">
                        <Receipt className="w-3.5 h-3.5 text-emerald-400/70" />
                        Create Invoice
                      </button>
                      <button role="menuitem" onClick={(e) => handleQuickAction(e, "book-appointment")} className="w-full flex items-center gap-2 px-3 py-2 text-[11px] hover:bg-white/[0.05] transition-colors">
                        <Calendar className="w-3.5 h-3.5 text-blue-400/70" />
                        Book Appointment
                      </button>
                      <button role="menuitem" onClick={(e) => handleQuickAction(e, "send-quote")} className="w-full flex items-center gap-2 px-3 py-2 text-[11px] hover:bg-white/[0.05] transition-colors">
                        <FileSignature className="w-3.5 h-3.5 text-violet-400/70" />
                        Send Quote
                      </button>
                    </div>
                  )}
                </div>
              )}
              <button
                onClick={handleDelete}
                className="p-1 rounded-lg hover:bg-red-500/10 text-muted-foreground/30 hover:text-red-400 transition-colors md:opacity-0 md:group-hover:opacity-100 min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 flex items-center justify-center"
                title="Delete contact"
                aria-label="Delete contact"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
              <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-md border ${badgeClass}`}>
                {contact.status ?? "LEAD"}
              </span>
            </div>
          </div>
          
          {(contact.companyName || contact.jobTitle) && (
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground/60 mt-0.5">
              <Building2 className="w-2.5 h-2.5" />
              <span className="truncate">
                {contact.jobTitle && contact.companyName
                  ? `${contact.jobTitle} at ${contact.companyName}`
                  : contact.companyName || contact.jobTitle}
              </span>
            </div>
          )}

          <div className="flex items-center gap-1.5 mt-1.5">
            <span
              className="inline-flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded-md border border-transparent"
              style={{ background: `${sourceInfo.color}10`, color: sourceInfo.color, borderColor: `${sourceInfo.color}15` }}
              title={`Source: ${sourceInfo.label}${contact.sourceDetail ? ` (${contact.sourceDetail})` : ""}`}
            >
              <SourceIcon className="w-2.5 h-2.5" />
              {sourceInfo.label}
            </span>
            {contact.preferredChannel && (
              <span className="text-[9px] text-muted-foreground/40">
                via {contact.preferredChannel}
              </span>
            )}
          </div>

          <div className="flex items-center gap-0.5 mt-2">
            {contact.email && (
              <a
                href={`mailto:${contact.email}`}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center justify-center w-7 h-7 rounded-lg hover:bg-blue-500/10 transition-colors"
                title={`Email ${contact.email}`}
                aria-label={`Email ${contact.email}`}
              >
                <Mail className="w-3.5 h-3.5 text-blue-400/60" />
              </a>
            )}
            {contact.phone && (
              <a
                href={`tel:${contact.phone}`}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center justify-center w-7 h-7 rounded-lg hover:bg-violet-500/10 transition-colors"
                title={`Call ${contact.phone}`}
                aria-label={`Call ${contact.phone}`}
              >
                <Phone className="w-3.5 h-3.5 text-violet-400/60" />
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
                  className="inline-flex items-center justify-center w-7 h-7 rounded-lg hover:bg-emerald-500/10 transition-colors"
                  title="WhatsApp"
                  aria-label="Message on WhatsApp"
                >
                  <MessageCircle className="w-3.5 h-3.5 text-emerald-500/60" />
                </a>
              );
            })()}

            <div className="flex-1" />

            {contact.tags && contact.tags.length > 0 && (
              <div className="flex items-center gap-1">
                {contact.tags.slice(0, 2).map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-md bg-white/[0.04] text-muted-foreground/50 border border-border/30"
                  >
                    <Tag className="w-2 h-2" />
                    {tag}
                  </span>
                ))}
                {contact.tags.length > 2 && (
                  <span className="text-[9px] text-muted-foreground/30">+{contact.tags.length - 2}</span>
                )}
              </div>
            )}
          </div>

          {contact.meta && (contact.meta.leadScore || contact.meta.outstandingBalance || contact.meta.totalRevenue || contact.meta.invoiceCount || contact.meta.bookingCount) && (
            <div className="flex items-center gap-2.5 mt-1.5 text-[9px] flex-wrap">
              {contact.meta.leadScore != null && contact.meta.leadScore > 0 && (
                <span className="text-muted-foreground/50">
                  Score <span className="font-semibold text-foreground/70">{contact.meta.leadScore}</span>
                </span>
              )}
              {contact.meta.totalRevenue != null && contact.meta.totalRevenue > 0 && (
                <span className="text-emerald-400/70 font-medium">
                  TTD {contact.meta.totalRevenue.toLocaleString("en-TT")}
                </span>
              )}
              {contact.meta.outstandingBalance != null && contact.meta.outstandingBalance > 0 && (
                <span className="text-[hsl(var(--kf-accent1))]/70 font-medium">
                  Owed TTD {contact.meta.outstandingBalance.toLocaleString("en-TT")}
                </span>
              )}
              {contact.meta.invoiceCount != null && contact.meta.invoiceCount > 0 && (
                <span className="text-muted-foreground/40">
                  {contact.meta.invoiceCount} inv
                </span>
              )}
              {contact.meta.bookingCount != null && contact.meta.bookingCount > 0 && (
                <span className="text-muted-foreground/40">
                  {contact.meta.bookingCount} book
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export const ContactCard = React.memo(ContactCardInner);
