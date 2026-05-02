"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Lightbulb, X, ChevronDown, ChevronUp } from "lucide-react";

interface GuideStep {
  title: string;
  description: string;
}

interface FeatureGuideProps {
  featureKey: string;
  title: string;
  description: string;
  steps: GuideStep[];
}

export function FeatureGuide({ featureKey, title, description, steps }: FeatureGuideProps) {
  const storageKey = `kf-guide-dismissed-${featureKey}`;
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(storageKey);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs external or derived state into local component state
    setDismissed(stored === "true");
  }, [storageKey]);

  if (dismissed === null) return null;

  const handleDismiss = () => {
    setDismissed(true);
    localStorage.setItem(storageKey, "true");
  };

  const handleShow = () => {
    setDismissed(false);
    localStorage.removeItem(storageKey);
  };

  if (dismissed) {
    return (
      <button
        onClick={handleShow}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-lg"
        style={{ background: "hsl(var(--kf-muted) / 0.3)" }}
      >
        <Lightbulb className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
        How to use this
      </button>
    );
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        className="rounded-xl overflow-hidden"
        style={{
          background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.06), hsl(var(--kf-accent2) / 0.04))",
          border: "1px solid hsl(var(--kf-accent1) / 0.15)",
        }}
      >
        <div className="px-4 py-3 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
              style={{ background: "hsl(var(--kf-accent1) / 0.12)" }}
            >
              <Lightbulb className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium">{title}</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => setExpanded(!expanded)}
              className="p-1.5 rounded-lg hover:bg-white/5 transition-colors text-muted-foreground hover:text-foreground"
            >
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            <button
              onClick={handleDismiss}
              className="p-1.5 rounded-lg hover:bg-white/5 transition-colors text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-4 pt-0">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {steps.map((step, i) => (
                    <div
                      key={i}
                      className="rounded-lg px-3 py-2.5 flex gap-2.5 items-start"
                      style={{
                        background: "hsl(var(--kf-muted) / 0.25)",
                        border: "1px solid hsl(var(--kf-border) / 0.2)",
                      }}
                    >
                      <span
                        className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5"
                        style={{
                          background: "hsl(var(--kf-accent1) / 0.15)",
                          color: "hsl(var(--kf-accent1))",
                        }}
                      >
                        {i + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs font-medium leading-tight">{step.title}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{step.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  );
}
