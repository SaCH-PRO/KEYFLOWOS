"use client";

import { motion } from "framer-motion";
import { BarChart3 } from "lucide-react";
import { ExpenseSummary, VendorAnalytics } from "@/lib/client";
import { SkeletonList } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ExpenseStats } from "./expense-stats";
import { ExpenseVendorsTab } from "./expense-vendors-tab";

interface ExpenseAnalyticsTabProps {
  summary: ExpenseSummary | null;
  vendors: VendorAnalytics[];
  loading?: boolean;
}

export function ExpenseAnalyticsTab({ summary, vendors, loading }: ExpenseAnalyticsTabProps) {
  if (loading) {
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

  if (!summary && vendors.length === 0) {
    return (
      <motion.div
        key="analytics-empty"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-6"
      >
        <EmptyState
          icon={BarChart3}
          title="No analytics data yet"
          description="Start tracking expenses to see spending trends, vendor breakdowns, and category insights."
          tip="Add expenses with categories and vendors for the richest analytics."
        />
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
