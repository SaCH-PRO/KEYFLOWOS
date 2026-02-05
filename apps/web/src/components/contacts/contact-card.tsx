"use client";

import { motion } from "framer-motion";
import { Mail, Phone, Building2, Tag, Trash2 } from "lucide-react";

export type ContactCardData = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  companyName?: string | null;
  jobTitle?: string | null;
  status?: string | null;
  tags?: string[];
  addressLine1?: string | null;
  city?: string | null;
  country?: string | null;
  meta?: {
    leadScore?: number | null;
    outstandingBalance?: number | null;
  } | null;
};

const STATUS_COLORS: Record<string, string> = {
  LEAD: "hsl(var(--kf-accent1))",
  PROSPECT: "hsl(var(--kf-accent2))",
  CLIENT: "hsl(142 76% 36%)",
  LOST: "hsl(var(--kf-muted-foreground))",
};

interface ContactCardProps {
  contact: ContactCardData;
  isSelected?: boolean;
  onClick?: () => void;
  onDelete?: (contact: ContactCardData) => void;
  index?: number;
}

export function ContactCard({ contact, isSelected, onClick, onDelete, index = 0 }: ContactCardProps) {
  const fullName = `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || "Unnamed";
  const initials = `${contact.firstName?.[0] ?? ""}${contact.lastName?.[0] ?? ""}`.toUpperCase() || "?";
  const statusColor = STATUS_COLORS[contact.status ?? ""] ?? STATUS_COLORS.LEAD;

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete?.(contact);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03 }}
      onClick={onClick}
      className={`kf-card p-4 cursor-pointer transition-all hover:scale-[1.01] group ${
        isSelected ? "ring-2 ring-[hsl(var(--kf-accent1))]" : ""
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className="h-10 w-10 rounded-full flex items-center justify-center text-white text-sm font-semibold flex-shrink-0"
          style={{ background: statusColor }}
        >
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-medium truncate">{fullName}</h3>
            <div className="flex items-center gap-2">
              <button
                onClick={handleDelete}
                className="p-1.5 rounded-md hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
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

          <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-muted-foreground">
            {contact.email && (
              <div className="flex items-center gap-1 truncate">
                <Mail className="w-3 h-3 flex-shrink-0" />
                <span className="truncate">{contact.email}</span>
              </div>
            )}
            {contact.phone && (
              <div className="flex items-center gap-1">
                <Phone className="w-3 h-3 flex-shrink-0" />
                <span>{contact.phone}</span>
              </div>
            )}
          </div>

          {contact.tags && contact.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {contact.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground"
                >
                  <Tag className="w-2.5 h-2.5" />
                  {tag}
                </span>
              ))}
              {contact.tags.length > 3 && (
                <span className="text-[10px] text-muted-foreground">+{contact.tags.length - 3}</span>
              )}
            </div>
          )}

          {(contact.meta?.leadScore || contact.meta?.outstandingBalance) && (
            <div className="flex items-center gap-3 mt-2 text-[10px]">
              {contact.meta.leadScore && (
                <span className="text-muted-foreground">
                  Score: <span className="font-medium text-foreground">{contact.meta.leadScore}</span>
                </span>
              )}
              {contact.meta.outstandingBalance && contact.meta.outstandingBalance > 0 && (
                <span style={{ color: "hsl(var(--kf-accent1))" }}>
                  Owed: TTD {contact.meta.outstandingBalance.toLocaleString()}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
