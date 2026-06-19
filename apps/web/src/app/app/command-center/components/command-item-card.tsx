"use client";

import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import type { CommandCenterItem } from "@/lib/api/business-command-center";
import { PriorityBadge } from "./priority-badge";
import { TypeBadge } from "./type-badge";

interface CommandItemCardProps {
  item: CommandCenterItem;
  index?: number;
  compact?: boolean;
}

export function CommandItemCard({ item, index = 0, compact }: CommandItemCardProps) {
  const router = useRouter();
  const primaryAction = item.actions[0];

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03 }}
      className={`rounded-xl border border-border/20 bg-card/40 ${compact ? "p-3" : "p-4"}`}
    >
      <div className="flex flex-wrap items-center gap-2 mb-1.5">
        <PriorityBadge priority={item.priority} />
        <TypeBadge type={item.type} />
        <span className="text-[10px] text-muted-foreground">{item.source}</span>
      </div>
      <h3 className={`font-semibold text-foreground ${compact ? "text-xs" : "text-sm"}`}>{item.title}</h3>
      <p className={`text-muted-foreground leading-relaxed mt-0.5 ${compact ? "text-[10px] line-clamp-2" : "text-xs"}`}>
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
          className="mt-2 inline-flex items-center gap-1 text-[10px] font-medium text-[hsl(var(--kf-accent1))] hover:text-[hsl(var(--kf-accent1))]/80 transition-colors disabled:opacity-50"
        >
          {primaryAction.label}
          <ArrowRight className="w-3 h-3" />
        </button>
      )}
    </motion.div>
  );
}
