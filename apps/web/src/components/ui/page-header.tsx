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
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{
              background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
            }}
          >
            <Icon className="w-5 h-5 text-white" />
          </div>
          {title}
        </h1>
        {subtitle && (
          <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
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
