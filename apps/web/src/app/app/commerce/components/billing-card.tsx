"use client";

import type { ReactNode } from "react";
import { formatAmount, formatRelativeDate, getStatusAccentColor, getContactInitials, getItemsSummary } from "../utils/commerce-utils";
import { getStatusBadge, BILLING_DOC_THEME, type BillingDocType } from "./commerce-types";

interface BillingCardProps {
  type: BillingDocType;
  number: string;
  status: string;
  contact: { firstName?: string | null; lastName?: string | null; email?: string | null } | null;
  total: number;
  currency: string;
  items: Array<{ description?: string | null }>;
  date: string;
  badges?: ReactNode;
  desktopActions: ReactNode;
  mobileActions: ReactNode;
  onClick: () => void;
}

export function BillingCard({
  type,
  number,
  status,
  contact,
  total,
  currency,
  items,
  date,
  badges,
  desktopActions,
  mobileActions,
  onClick,
}: BillingCardProps) {
  const theme = BILLING_DOC_THEME[type];
  const contactName = contact
    ? `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || contact.email || "—"
    : "—";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className="group relative rounded-xl border border-border/30 hover:border-border/50 bg-white/[0.015] hover:bg-white/[0.04] cursor-pointer transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring overflow-hidden"
    >
      <div
        className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl"
        style={{ backgroundColor: getStatusAccentColor(status) }}
      />

      <div className="pl-4 pr-3 py-3 sm:py-3.5">
        <div className="flex items-start gap-3">
          <div
            className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center text-xs font-bold shrink-0 mt-0.5"
            style={{ backgroundColor: theme.avatarBg }}
          >
            <span className={theme.avatarText}>{getContactInitials(contact)}</span>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-[13px] font-semibold text-foreground leading-tight">
                {number}
              </span>
              <span
                className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium border leading-none ${getStatusBadge(status)}`}
              >
                {status}
              </span>
              {badges}
            </div>
            <div className="text-[13px] text-foreground/80 mt-0.5 truncate font-medium">
              {contactName}
            </div>
            <div className="flex items-center gap-1.5 mt-1 text-[11px] text-muted-foreground/50">
              <span className="truncate">{getItemsSummary(items)}</span>
              <span className="text-muted-foreground/25">·</span>
              <span className="shrink-0">{date ? formatRelativeDate(date) : ""}</span>
            </div>
          </div>

          <div className="text-right shrink-0 flex flex-col items-end gap-1.5">
            <span className="text-[15px] font-bold text-foreground whitespace-nowrap tracking-tight">
              {formatAmount(total, currency)}
            </span>

            <div
              className="hidden md:flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => e.stopPropagation()}
            >
              {desktopActions}
            </div>
          </div>
        </div>

        <div
          className="flex md:hidden items-center gap-1 mt-2 pt-2 border-t border-border/15 overflow-x-auto scrollbar-none"
          onClick={(e) => e.stopPropagation()}
        >
          {mobileActions}
        </div>
      </div>
    </div>
  );
}
