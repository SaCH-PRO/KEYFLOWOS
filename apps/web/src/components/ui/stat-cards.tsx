"use client";

import { motion } from "framer-motion";
import { MetricCard } from "./metric-card";

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
      {items.map((kpi) => (
        <motion.div key={kpi.label} variants={fadeUp}>
          <MetricCard
            label={kpi.label}
            value={kpi.value}
            icon={kpi.icon}
            iconColor={kpi.color}
          />
        </motion.div>
      ))}
    </motion.div>
  );
}
