"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface SmartSkeletonProps {
  variant?: "card" | "list" | "stat" | "hero" | "flow";
  count?: number;
  className?: string;
}

export function SmartSkeleton({ variant = "card", count = 1, className }: SmartSkeletonProps) {
  const renderSkeleton = () => {
    switch (variant) {
      case "hero":
        return (
          <div className={cn("space-y-4", className)}>
            <div className="space-y-2">
              <div className="h-4 w-32 rounded bg-muted animate-pulse" />
              <div className="h-10 w-3/4 rounded-lg bg-muted animate-pulse" />
              <div className="h-10 w-1/2 rounded-lg bg-muted animate-pulse" />
            </div>
            <div className="h-16 w-full rounded-xl bg-muted/50 animate-pulse" />
          </div>
        );

      case "stat":
        return (
          <div className={cn("grid grid-cols-2 lg:grid-cols-4 gap-3", className)}>
            {Array.from({ length: count }).map((_, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 }}
                className="kf-card-depth p-4 space-y-3"
              >
                <div className="flex items-start justify-between">
                  <div className="h-8 w-8 rounded-lg bg-muted animate-pulse" />
                  <div className="h-4 w-14 rounded-full bg-muted animate-pulse" />
                </div>
                <div className="h-7 w-20 rounded bg-muted animate-pulse" />
                <div className="h-3 w-24 rounded bg-muted animate-pulse" />
              </motion.div>
            ))}
          </div>
        );

      case "list":
        return (
          <div className={cn("space-y-2", className)}>
            {Array.from({ length: count }).map((_, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className="kf-card-list-row flex items-center gap-3"
              >
                <div className="h-8 w-8 rounded-lg bg-muted animate-pulse shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 w-1/3 rounded bg-muted animate-pulse" />
                  <div className="h-3 w-1/4 rounded bg-muted animate-pulse" />
                </div>
                <div className="h-6 w-16 rounded-full bg-muted animate-pulse shrink-0" />
              </motion.div>
            ))}
          </div>
        );

      case "flow":
        return (
          <div className={cn("h-20 w-full relative overflow-hidden", className)}>
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-full h-[2px] bg-muted animate-pulse" />
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-muted animate-pulse" />
            </div>
          </div>
        );

      default: // card
        return (
          <div className={cn("space-y-4", className)}>
            {Array.from({ length: count }).map((_, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 }}
                className="kf-card-depth p-4 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div className="h-5 w-1/3 rounded bg-muted animate-pulse" />
                  <div className="h-5 w-5 rounded-full bg-muted animate-pulse" />
                </div>
                <div className="space-y-2">
                  <div className="h-3 w-full rounded bg-muted animate-pulse" />
                  <div className="h-3 w-3/4 rounded bg-muted animate-pulse" />
                </div>
              </motion.div>
            ))}
          </div>
        );
    }
  };

  return renderSkeleton();
}
