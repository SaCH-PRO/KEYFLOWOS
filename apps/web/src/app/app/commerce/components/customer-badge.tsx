"use client";

import React from "react";
import { Shield, AlertTriangle, Star, Clock, UserPlus } from "lucide-react";
import type { CustomerBadge as CustomerBadgeType } from "../hooks/use-customer-badge";

const BADGE_ICONS = {
  healthy: Shield,
  slow_payer: Clock,
  high_value: Star,
  at_risk: AlertTriangle,
  new_client: UserPlus,
} as const;

interface CustomerBadgeProps {
  badge: CustomerBadgeType | null;
  size?: "sm" | "md";
  showDescription?: boolean;
}

export const CustomerBadge = React.memo(function CustomerBadge({
  badge,
  size = "sm",
  showDescription = false,
}: CustomerBadgeProps) {
  if (!badge) return null;

  const Icon = BADGE_ICONS[badge.type] ?? Shield;
  const isSmall = size === "sm";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border font-medium ${badge.bgColor} ${badge.color} ${badge.borderColor} ${
        isSmall ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]"
      }`}
      title={badge.description}
    >
      <Icon className={isSmall ? "w-2.5 h-2.5" : "w-3 h-3"} />
      {badge.label}
      {showDescription && (
        <span className="text-muted-foreground/60 ml-0.5">{badge.description}</span>
      )}
    </span>
  );
});
