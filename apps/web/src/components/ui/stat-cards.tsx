"use client";

import { motion } from "framer-motion";

interface StatItem {
  label: string;
  value: string | number;
  sub?: React.ReactNode;
  icon: React.ElementType;
  color: string;
}

interface StatCardsProps {
  items: StatItem[];
  columns?: 2 | 3 | 4;
}

const stagger = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.08 } },
};

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 24 } },
};

export function StatCards({ items, columns = 4 }: StatCardsProps) {
  const gridCols =
    columns === 2
      ? "grid-cols-1 sm:grid-cols-2"
      : columns === 3
        ? "grid-cols-1 sm:grid-cols-3"
        : "grid-cols-2 md:grid-cols-4";

  return (
    <motion.div
      role="region"
      aria-label="Statistics"
      variants={stagger}
      initial="hidden"
      animate="show"
      className={`grid gap-3 ${gridCols}`}
    >
      {items.map((kpi) => {
        const Icon = kpi.icon;
        return (
          <motion.div
            key={kpi.label}
            variants={fadeUp}
            className="kf-card kf-card-hover p-4 rounded-xl relative overflow-hidden cursor-default"
          >
            <div className="flex items-start justify-between">
              <div className="space-y-1 flex-1 min-w-0">
                <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-medium">
                  {kpi.label}
                </p>
                <p className="text-xl font-bold truncate">{kpi.value}</p>
                {kpi.sub && (
                  <p className="text-xs text-muted-foreground">{kpi.sub}</p>
                )}
              </div>
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: `${kpi.color}20` }}
              >
                <Icon className="w-5 h-5" style={{ color: kpi.color }} />
              </div>
            </div>
          </motion.div>
        );
      })}
    </motion.div>
  );
}
