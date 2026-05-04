"use client";

import { motion } from "framer-motion";
import { BillingTab } from "../business/billing-tab";

export default function BillingSettingsPage() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6 max-w-3xl"
    >
      <div className="kf-card p-6">
        <BillingTab />
      </div>
    </motion.div>
  );
}
