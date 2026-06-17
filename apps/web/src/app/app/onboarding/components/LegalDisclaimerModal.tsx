"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ShieldAlert, X } from "lucide-react";

interface LegalDisclaimerModalProps {
  open: boolean;
  onAccept: () => void;
  onCancel?: () => void;
  loading?: boolean;
}

export function LegalDisclaimerModal({
  open,
  onAccept,
  onCancel,
  loading = false,
}: LegalDisclaimerModalProps) {
  const [acknowledged, setAcknowledged] = useState(false);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[var(--kf-z-modal)] flex items-center justify-center p-4"
          style={{ background: "hsl(var(--kf-foreground) / 0.45)" }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 12 }}
            className="kf-glass-surface w-full max-w-md p-5 space-y-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: "hsl(var(--kf-warning) / 0.1)" }}
              >
                <ShieldAlert className="w-5 h-5" style={{ color: "hsl(var(--kf-warning))" }} />
              </div>
              {onCancel && (
                <button
                  onClick={onCancel}
                  disabled={loading}
                  className="p-1.5 rounded-lg hover:bg-muted transition-colors"
                >
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              )}
            </div>

            <div className="space-y-2">
              <h3 className="text-lg font-bold">Important disclaimer</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                KEY provides business preparation and administrative guidance. It does not replace a
                licensed attorney, accountant, tax advisor, or regulator. Review all legal, tax, and
                financial decisions with the appropriate professional before filing or signing.
              </p>
            </div>

            <label className="flex items-start gap-3 p-3 rounded-lg cursor-pointer hover:bg-muted transition-colors">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                disabled={loading}
                className="mt-0.5 w-4 h-4 rounded"
                style={{ accentColor: "hsl(var(--kf-accent1))" }}
              />
              <span className="text-sm text-muted-foreground">
                I understand that KEY is not a substitute for professional advice.
              </span>
            </label>

            <div className="flex justify-end gap-2 pt-2">
              {onCancel && (
                <button onClick={onCancel} disabled={loading} className="kf-btn-secondary">
                  Cancel
                </button>
              )}
              <button
                onClick={onAccept}
                disabled={!acknowledged || loading}
                className="kf-btn-primary"
              >
                {loading ? "Saving..." : "I understand"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
