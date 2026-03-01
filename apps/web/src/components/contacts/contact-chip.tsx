"use client";

import { X } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  CLIENT: "bg-emerald-500",
  PROSPECT: "bg-blue-500",
  LEAD: "bg-amber-500",
  LOST: "bg-red-500",
};

interface ContactChipProps {
  contact: {
    id: string;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    status?: string;
  };
  size?: "sm" | "md";
  showStatus?: boolean;
  showEmail?: boolean;
  removable?: boolean;
  onRemove?: () => void;
  onClick?: () => void;
  className?: string;
}

export function ContactChip({
  contact,
  size = "md",
  showStatus = false,
  showEmail = false,
  removable = false,
  onRemove,
  onClick,
  className = "",
}: ContactChipProps) {
  const name =
    [contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
    contact.email ||
    "Unknown";
  const initials = (
    (contact.firstName?.[0] ?? "") + (contact.lastName?.[0] ?? "")
  ).toUpperCase() || (contact.email?.[0]?.toUpperCase() ?? "?");

  const avatarSize = size === "sm" ? "w-6 h-6" : "w-8 h-8";
  const textSize = size === "sm" ? "text-xs" : "text-sm";
  const initialsSize = size === "sm" ? "text-[10px]" : "text-[11px]";

  const Wrapper = onClick ? "button" : "div";

  return (
    <Wrapper
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2 py-1 transition-colors ${
        onClick ? "cursor-pointer hover:bg-muted" : ""
      } ${className}`}
    >
      <div
        className={`${avatarSize} rounded-full flex items-center justify-center flex-shrink-0 ${initialsSize} font-bold`}
        style={{
          background: "hsl(var(--kf-accent1) / 0.15)",
          color: "hsl(var(--kf-accent1))",
        }}
      >
        {initials}
      </div>
      <span className={`${textSize} font-medium truncate max-w-[120px]`}>{name}</span>
      {showEmail && contact.email && (
        <span className="text-[10px] text-muted-foreground truncate max-w-[100px]">
          {contact.email}
        </span>
      )}
      {showStatus && contact.status && (
        <span
          className={`w-2 h-2 rounded-full flex-shrink-0 ${
            STATUS_COLORS[contact.status] ?? "bg-gray-400"
          }`}
        />
      )}
      {removable && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove?.();
          }}
          className="ml-0.5 p-0.5 rounded-full hover:bg-muted-foreground/20 transition-colors"
        >
          <X className={size === "sm" ? "w-3 h-3" : "w-3.5 h-3.5"} />
        </button>
      )}
    </Wrapper>
  );
}
