"use client";

import { motion } from "framer-motion";
import { ExpenseSummary, VendorAnalytics } from "@/lib/client";
import { SkeletonList } from "@/components/ui/skeleton";
import { ExpenseStats } from "./expense-stats";
import { ExpenseVendorsTab } from "./expense-vendors-tab";

interface ExpenseAnalyticsTabProps {
  summary: ExpenseSummary | null;
  vendors: VendorAnalytics[];
}

export function ExpenseAnalyticsTab({ summary, vendors }: ExpenseAnalyticsTabProps) {
  if (!summary && vendors.length === 0) {
    return (
      <motion.div
        key="analytics-loading"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-6"
      >
        <SkeletonList rows={4} cols={3} />
      </motion.div>
    );
  }

  return (
    <motion.div
      key="analytics"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="space-y-6"
    >
      <ExpenseStats summary={summary} />
      <ExpenseVendorsTab vendors={vendors} />
    </motion.div>
  );
}
