"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Sparkles, Loader2 } from "lucide-react";
import { apiGet } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";
import { GenesisConversation } from "./components/GenesisConversation";

export default function OnboardingPage() {
  const [checking, setChecking] = useState(true);
  const [readiness, setReadiness] = useState<{ overall: number } | null>(null);

  useEffect(() => {
    const bid = getStoredBusinessId();
    if (!bid) {
      setChecking(false);
      return;
    }
    apiGet<{ overall: number }>(`/business-genesis/businesses/${bid}/readiness`)
      .then(({ data }) => {
        if (data) setReadiness(data);
      })
      .finally(() => setChecking(false));
  }, []);

  if (checking) {
    return (
      <div className="max-w-2xl mx-auto py-12 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: "hsl(var(--kf-accent1))" }} />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto py-6 sm:py-8 px-4 sm:px-6 space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center space-y-3"
      >
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto"
          style={{ background: "hsl(var(--kf-accent1) / 0.1)" }}
        >
          <Sparkles className="w-8 h-8" style={{ color: "hsl(var(--kf-accent1))" }} />
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold">
          {readiness && readiness.overall >= 80
            ? "Your Business Genome is shaping up"
            : "Let's build your Business Genome"}
        </h1>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Spend a few minutes with KEY. The more it knows about your business, the better it can run
          as your digital co-founder.
        </p>
        {readiness && (
          <div className="flex items-center justify-center gap-3 pt-1">
            <span className="text-xs font-medium text-muted-foreground">
              Readiness {readiness.overall}%
            </span>
            <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{ background: "hsl(var(--kf-accent1))" }}
                initial={{ width: 0 }}
                animate={{ width: `${readiness.overall}%` }}
                transition={{ duration: 0.4 }}
              />
            </div>
          </div>
        )}
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="kf-card p-4 sm:p-6"
        style={{
          background: "hsl(var(--kf-card))",
          border: "1px solid hsl(var(--kf-border) / 0.3)",
        }}
      >
        <GenesisConversation />
      </motion.div>
    </div>
  );
}
