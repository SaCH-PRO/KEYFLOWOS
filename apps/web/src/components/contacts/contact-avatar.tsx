"use client";

import { STATUS_COLORS } from "@/lib/crm-utils";

interface ContactAvatarProps {
  contact?: {
    id?: string;
    firstName?: string | null;
    lastName?: string | null;
    displayName?: string | null;
    email?: string | null;
    status?: string | null;
  } | null;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  selected?: boolean;
  showOnline?: boolean;
  className?: string;
}

const SIZE_MAP: Record<
  NonNullable<ContactAvatarProps["size"]>,
  { container: string; text: string }
> = {
  xs: { container: "w-6 h-6", text: "text-[10px]" },
  sm: { container: "w-8 h-8", text: "text-[11px]" },
  md: { container: "w-10 h-10", text: "text-sm" },
  lg: { container: "w-14 h-14", text: "text-lg" },
  xl: { container: "w-16 h-16", text: "text-xl" },
};

const ONLINE_DOT_MAP: Record<NonNullable<ContactAvatarProps["size"]>, string> = {
  xs: "w-1.5 h-1.5 border",
  sm: "w-2 h-2 border",
  md: "w-2.5 h-2.5 border-2",
  lg: "w-3 h-3 border-2",
  xl: "w-3.5 h-3.5 border-2",
};

function getInitials(contact: ContactAvatarProps["contact"]): string {
  if (!contact) return "?";

  const display = contact.displayName?.trim();
  if (display) {
    const parts = display.split(/\s+/);
    if (parts.length > 1) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return display.slice(0, 2).toUpperCase();
  }

  const fromNames = `${contact.firstName?.[0] ?? ""}${contact.lastName?.[0] ?? ""}`.toUpperCase();
  if (fromNames) return fromNames;

  return contact.email?.[0]?.toUpperCase() ?? "?";
}

export function ContactAvatar({
  contact,
  size = "sm",
  selected = false,
  showOnline = false,
  className = "",
}: ContactAvatarProps) {
  const { container, text } = SIZE_MAP[size];
  const statusColor = STATUS_COLORS[contact?.status ?? ""] ?? STATUS_COLORS.LEAD;
  const initials = getInitials(contact);

  return (
    <div className={`relative inline-flex shrink-0 ${className}`}>
      <div
        className={`${container} rounded-full flex items-center justify-center font-bold text-white ${text} ${
          selected
            ? "ring-2 ring-[hsl(var(--kf-accent2))] ring-offset-2 ring-offset-background"
            : ""
        }`}
        style={{ background: statusColor }}
        aria-label={`Avatar for ${contact?.displayName || `${contact?.firstName ?? ""} ${contact?.lastName ?? ""}`.trim() || contact?.email || "Unknown"}`}
      >
        {initials}
      </div>
      {showOnline && (
        <span
          className={`absolute -bottom-0.5 -right-0.5 rounded-full bg-emerald-500 border-background ${ONLINE_DOT_MAP[size]}`}
        />
      )}
    </div>
  );
}
