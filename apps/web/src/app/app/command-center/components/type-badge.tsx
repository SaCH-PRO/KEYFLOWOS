"use client";

import type { CommandCenterItemType } from "@/lib/api/business-command-center";

const labels: Record<CommandCenterItemType, string> = {
  KEY_APPROVAL: "Approval",
  KEY_APPROVED: "Execute",
  TEMPORAL_URGENT: "Urgent",
  RISK: "Risk",
  OPPORTUNITY: "Opportunity",
  GENOME_PROPOSAL: "Genome",
  ASSET_RISK: "Asset",
  CONSTITUTION: "Constitution",
  EXECUTIVE_MODE: "Mode",
  DOCUMENT: "Document",
};

interface TypeBadgeProps {
  type: CommandCenterItemType;
}

export function TypeBadge({ type }: TypeBadgeProps) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium text-muted-foreground bg-muted/40">
      {labels[type]}
    </span>
  );
}
