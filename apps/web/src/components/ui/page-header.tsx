"use client";

import { motion } from "framer-motion";
import { Plus } from "lucide-react";

interface PageHeaderProps {
  icon: React.ElementType;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  actionIcon?: React.ElementType;
  onAction?: () => void;
  rightSlot?: React.ReactNode;
}

export function PageHeader({
  icon: Icon,
  title,
  subtitle,
  actionLabel,
  actionIcon: ActionIcon = Plus,
  onAction,
  rightSlot,
}: PageHeaderProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col md:flex-row md:items-center md:justify-between gap-4"
    >
      <div>
        <h1 className="text-xl md:text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Icon className="w-6 h-6" style={{ color: "hsl(var(--kf-accent1))" }} />
          {title}
        </h1>
        {subtitle && (
          <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
        )}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {rightSlot}
        {actionLabel && onAction && (
          <button
            onClick={onAction}
            className="kf-btn-primary inline-flex items-center gap-2 text-sm"
          >
            <ActionIcon className="w-4 h-4" />
            {actionLabel}
          </button>
        )}
      </div>
    </motion.div>
  );
}
