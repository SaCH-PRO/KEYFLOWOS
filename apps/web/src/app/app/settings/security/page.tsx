"use client";

import SecuritySection from "../../profile/components/security-section";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, AlertCircle } from "lucide-react";

export default function SecuritySettingsPage() {
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);

  return (
    <div className="max-w-2xl space-y-4">
      <AnimatePresence>
        {status && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm"
            style={{
              border: `1px solid ${status.type === "success" ? "hsl(var(--kf-success) / 0.4)" : "hsl(var(--kf-error) / 0.4)"}`,
              background: status.type === "success" ? "hsl(var(--kf-success) / 0.08)" : "hsl(var(--kf-error) / 0.08)",
              color: status.type === "success" ? "hsl(var(--kf-success))" : "hsl(var(--kf-error))",
            }}
          >
            {status.type === "success" ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
            {status.message}
          </motion.div>
        )}
      </AnimatePresence>
      <SecuritySection onStatus={setStatus} />
    </div>
  );
}
