"use client";

import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Surface } from "@/components/ui-v2/surface";
import { Badge } from "@/components/ui-v2/badge";
import type { CommandCenterItem, CommandCenterPriority, CommandCenterItemType } from "@/lib/api/business-command-center";

interface CommandItemCardV2Props {
  item: CommandCenterItem;
  index?: number;
  compact?: boolean;
}

const priorityColor: Record<CommandCenterPriority, "rose" | "gold" | "orange" | "muted"> = {
  CRITICAL: "rose",
  HIGH: "gold",
  MEDIUM: "orange",
  LOW: "muted",
};

const typeLabels: Record<CommandCenterItemType, string> = {
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
  KEY_GENOME_GAP: "Genome Gap",
  MODULE_READINESS: "Readiness",
  MISSING_FACT: "Missing Fact",
};

const typeColor: Record<CommandCenterItemType, "violet" | "gold" | "rose" | "mint" | "sky" | "muted"> = {
  KEY_APPROVAL: "violet",
  KEY_APPROVED: "mint",
  TEMPORAL_URGENT: "rose",
  RISK: "rose",
  OPPORTUNITY: "gold",
  GENOME_PROPOSAL: "violet",
  ASSET_RISK: "rose",
  CONSTITUTION: "violet",
  EXECUTIVE_MODE: "sky",
  DOCUMENT: "sky",
  KEY_GENOME_GAP: "violet",
  MODULE_READINESS: "mint",
  MISSING_FACT: "muted",
};

export function CommandItemCardV2({ item, index = 0, compact }: CommandItemCardV2Props) {
  const router = useRouter();
  const primaryAction = item.actions[0];

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03 }}
    >
      <Surface
        className={cn(
          "transition-all hover:shadow-sm",
          compact ? "p-3" : "p-4",
        )}
      >
        <div className="flex flex-wrap items-center gap-2 mb-1.5">
          <Badge color={priorityColor[item.priority]}>{item.priority}</Badge>
          <Badge color={typeColor[item.type]} variant="status">
            {typeLabels[item.type]}
          </Badge>
          <span className="text-[10px] text-muted-foreground font-mono uppercase tracking-wide">{item.source}</span>
        </div>
        <h3 className={cn("font-semibold text-foreground", compact ? "text-xs" : "text-sm")}>{item.title}</h3>
        <p
          className={cn(
            "text-muted-foreground leading-relaxed mt-0.5",
            compact ? "text-[10px] line-clamp-2" : "text-xs",
          )}
        >
          {item.summary}
        </p>
        {!compact && item.evidence.length > 0 && (
          <ul className="mt-2 space-y-0.5">
            {item.evidence.slice(0, 3).map((e, i) => (
              <li key={i} className="text-[10px] text-muted-foreground flex items-start gap-1.5">
                <span className="w-1 h-1 rounded-full bg-muted-foreground/50 mt-1.5 shrink-0" />
                {e}
              </li>
            ))}
          </ul>
        )}
        {primaryAction && (
          <button
            onClick={() => primaryAction.href && router.push(primaryAction.href)}
            disabled={!primaryAction.href}
            className="mt-2 inline-flex items-center gap-1 text-[10px] font-medium text-primary hover:text-primary/80 transition-colors disabled:opacity-50"
          >
            {primaryAction.label}
            <ArrowRight className="w-3 h-3" />
          </button>
        )}
      </Surface>
    </motion.div>
  );
}
