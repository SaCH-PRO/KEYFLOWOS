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
      className={`kf-card p-4 cursor-pointer transition-all hover:scale-[1.01] group ${
        isSelected ? "ring-2 ring-[hsl(var(--kf-accent1))]" : ""
      } ${selected ? "ring-2 ring-[hsl(var(--kf-accent2))]" : ""}`}
    >
      <div className="flex items-start gap-3">
        {selectable && (
          <div className="flex items-center pt-1">
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggleSelect?.(contact.id)}
              onClick={(e) => e.stopPropagation()}
              className="w-4 h-4 rounded border-border accent-[hsl(var(--kf-accent1))] cursor-pointer"
            />
          </div>
        )}

        <div
          className="h-10 w-10 rounded-full flex items-center justify-center text-white text-sm font-semibold flex-shrink-0 relative"
          style={{ background: statusColor }}
        >
          {initials}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="font-medium truncate">{fullName}</h3>
              {onTogglePin && (
                <button
                  onClick={handlePin}
                  className={`p-0.5 rounded transition-colors flex-shrink-0 ${isPinned ? "text-yellow-400" : "text-muted-foreground md:opacity-0 md:group-hover:opacity-100"}`}
                  title={isPinned ? "Unpin" : "Pin contact"}
                >
                  <Star className={`w-3.5 h-3.5 ${isPinned ? "fill-current" : ""}`} />
                </button>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {onQuickAction && (
                <div className="relative" ref={actionsRef}>
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowActions(!showActions); }}
                    className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors md:opacity-0 md:group-hover:opacity-100 min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 flex items-center justify-center"
                    title="Quick actions"
                  >
                    <MoreHorizontal className="w-3.5 h-3.5" />
                  </button>
                  {showActions && (
                    <div className="absolute right-0 top-8 z-50 w-48 kf-card border border-border shadow-xl rounded-xl py-1 animate-in fade-in zoom-in-95">
                      <button onClick={(e) => handleQuickAction(e, "create-invoice")} className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50 transition-colors">
                        <Receipt className="w-4 h-4 text-emerald-400" />
                        Create Invoice
                      </button>
                      <button onClick={(e) => handleQuickAction(e, "book-appointment")} className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50 transition-colors">
                        <Calendar className="w-4 h-4 text-blue-400" />
                        Book Appointment
                      </button>
                      <button onClick={(e) => handleQuickAction(e, "send-quote")} className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50 transition-colors">
                        <FileSignature className="w-4 h-4 text-violet-400" />
                        Send Quote
                      </button>
                    </div>
                  )}
                </div>
              )}
              <button
                onClick={handleDelete}
                className="p-1.5 rounded-md hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors md:opacity-0 md:group-hover:opacity-100 min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 flex items-center justify-center"
                title="Delete contact"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
              <span
                className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                style={{ background: `${statusColor}20`, color: statusColor }}
              >
                {contact.status ?? "LEAD"}
              </span>
            </div>
          </div>
          
          {(contact.companyName || contact.jobTitle) && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
              <Building2 className="w-3 h-3" />
              <span className="truncate">
                {contact.jobTitle && contact.companyName
                  ? `${contact.jobTitle} at ${contact.companyName}`
                  : contact.companyName || contact.jobTitle}
              </span>
            </div>
          )}

          <div className="flex items-center gap-2 mt-1.5">
            <span
              className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md"
              style={{ background: `${sourceInfo.color}15`, color: sourceInfo.color }}
              title={`Source: ${sourceInfo.label}${contact.sourceDetail ? ` (${contact.sourceDetail})` : ""}`}
            >
              <SourceIcon className="w-2.5 h-2.5" />
              {sourceInfo.label}
            </span>
            {contact.preferredChannel && (
              <span className="text-[10px] text-muted-foreground">
                via {contact.preferredChannel}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 mt-2">
            {contact.email && (
              <a
                href={`mailto:${contact.email}`}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center justify-center w-8 h-8 rounded-lg hover:bg-blue-500/10 transition-colors"
                title={`Email ${contact.email}`}
              >
                <Mail className="w-4 h-4 text-blue-400" />
              </a>
            )}
            {contact.phone && (
              <a
                href={`tel:${contact.phone}`}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center justify-center w-8 h-8 rounded-lg hover:bg-violet-500/10 transition-colors"
                title={`Call ${contact.phone}`}
              >
                <Phone className="w-4 h-4 text-violet-400" />
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
                  className="inline-flex items-center justify-center w-8 h-8 rounded-lg hover:bg-emerald-500/10 transition-colors"
                  title="WhatsApp"
                >
                  <MessageCircle className="w-4 h-4 text-emerald-500" />
                </a>
              );
            })()}

            <div className="flex-1" />

            {contact.tags && contact.tags.length > 0 && (
              <div className="flex items-center gap-1">
                {contact.tags.slice(0, 2).map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground"
                  >
                    <Tag className="w-2.5 h-2.5" />
                    {tag}
                  </span>
                ))}
                {contact.tags.length > 2 && (
                  <span className="text-[10px] text-muted-foreground">+{contact.tags.length - 2}</span>
                )}
              </div>
            )}
          </div>

          {contact.meta && (contact.meta.leadScore || contact.meta.outstandingBalance || contact.meta.totalRevenue || contact.meta.invoiceCount || contact.meta.bookingCount) && (
            <div className="flex items-center gap-3 mt-1.5 text-[10px] flex-wrap">
              {contact.meta.leadScore != null && contact.meta.leadScore > 0 && (
                <span className="text-muted-foreground">
                  Score: <span className="font-medium text-foreground">{contact.meta.leadScore}</span>
                </span>
              )}
              {contact.meta.totalRevenue != null && contact.meta.totalRevenue > 0 && (
                <span className="text-emerald-400">
                  Revenue: TTD {contact.meta.totalRevenue.toLocaleString()}
                </span>
              )}
              {contact.meta.outstandingBalance != null && contact.meta.outstandingBalance > 0 && (
                <span style={{ color: "hsl(var(--kf-accent1))" }}>
                  Owed: TTD {contact.meta.outstandingBalance.toLocaleString()}
                </span>
              )}
              {contact.meta.invoiceCount != null && contact.meta.invoiceCount > 0 && (
                <span className="text-muted-foreground">
                  {contact.meta.invoiceCount} invoice{contact.meta.invoiceCount !== 1 ? "s" : ""}
                </span>
              )}
              {contact.meta.bookingCount != null && contact.meta.bookingCount > 0 && (
                <span className="text-muted-foreground">
                  {contact.meta.bookingCount} booking{contact.meta.bookingCount !== 1 ? "s" : ""}
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
