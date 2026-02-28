"use client";

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

interface ContactDetailHeaderProps {
  contact: ContactDetailData;
  isPinned?: boolean;
  onTogglePin?: (id: string) => void;
  onClose?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onUpdateStatus?: (status: string) => Promise<void>;
  onQuickAction?: (contactId: string, action: DetailQuickAction) => void;
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
}: ContactDetailHeaderProps) {
  const fullName = `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || "Unnamed";
  const initials = `${contact.firstName?.[0] ?? ""}${contact.lastName?.[0] ?? ""}`.toUpperCase() || "?";
  const statusColor = STATUS_COLORS[contact.status ?? ""] ?? STATUS_COLORS.LEAD;
  const waPhone = getContactPhone(contact);
  const sourceKey = (contact.source || "manual").toLowerCase().replace(/[_\s]/g, "-");
  const sourceInfo = SOURCE_CONFIG[sourceKey] || { label: contact.source || "Unknown", icon: Globe };
  const SourceIcon = sourceInfo.icon;

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
